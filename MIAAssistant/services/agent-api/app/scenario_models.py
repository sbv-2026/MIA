from datetime import datetime
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class WireModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Recipient(WireModel):
    address: str = Field(min_length=1, max_length=128)
    pronoun: Literal["anh", "chị", "anh/chị"]

    @model_validator(mode="after")
    def consistent_address(self):
        if self.pronoun == "anh/chị":
            if self.address != self.pronoun:
                raise ValueError("Fallback address must not contain a name")
        elif not self.address.startswith(self.pronoun + " ") or not self.address[len(self.pronoun) + 1:].strip():
            raise ValueError("Address must contain the configured pronoun and name")
        return self


class Todo(WireModel):
    id: str = Field(min_length=1, max_length=128)
    todoType: str = Field(min_length=1, max_length=128)
    loanAccount: str | None = Field(default=None, min_length=1, max_length=64)
    business: str | None = Field(default=None, min_length=1, max_length=128)
    dueDate: str | None = Field(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    amount: float | None = Field(default=None, gt=0)


class AssistantData(WireModel):
    sessionId: str = Field(min_length=1, max_length=128)
    recipient: Recipient
    todoList: list[Todo] = Field(max_length=1000)
    offeringIds: list[str] = Field(max_length=100)
    capturedAt: datetime

    @model_validator(mode="after")
    def unique_ids(self):
        if self.capturedAt.tzinfo is None:
            raise ValueError("capturedAt must include timezone")
        if len({todo.id for todo in self.todoList}) != len(self.todoList):
            raise ValueError("Duplicate todo id")
        if len(set(self.offeringIds)) != len(self.offeringIds) or any(not item or len(item) > 128 for item in self.offeringIds):
            raise ValueError("Invalid offering ids")
        return self


class Feature(WireModel):
    routeId: Literal["home", "transfer", "qr-payment", "disbursement"]
    screenId: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=128)
    aliases: list[str] = Field(default_factory=list, max_length=20)
    categoryPath: list[str] | None = Field(default=None, min_length=3, max_length=3)

    @model_validator(mode="after")
    def category_labels(self):
        if self.categoryPath and any(not label.strip() or len(label) > 128 for label in self.categoryPath):
            raise ValueError("Invalid category path")
        return self
