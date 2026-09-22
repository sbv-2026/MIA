"""Demo customer configuration; identity is resolved only at session creation."""
from copy import deepcopy
from datetime import UTC, datetime, date
from pathlib import Path
from threading import RLock
from typing import Literal

import yaml
import re
import logging
from pydantic import AliasChoices, BaseModel, ConfigDict, Field, field_validator, model_validator


class ConfigModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class DemoUser(ConfigModel):
    username: str = Field(min_length=1, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    gender: Literal["Nam", "Nữ", "Không xác định"]
    user_email: str = Field(default="", max_length=254)
    CIF_Number: str = Field(default="", max_length=64)
    fullName: str = Field(default="", max_length=128, validation_alias=AliasChoices("Full name", "fullName", "Full_name"))
    phoneNumber: str = Field(default="", max_length=32, validation_alias=AliasChoices("phoneNumber", "phone_number"))
    companyName: str = Field(default="", max_length=256, validation_alias=AliasChoices("Corp_name", "companyName"))

    @field_validator("user_email")
    @classmethod
    def usable_email(cls, value):
        if value and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
            logging.getLogger(__name__).warning("An incomplete user_email is omitted from support CC until configuration is corrected")
            return ""
        return value


class UsersConfig(ConfigModel):
    version: Literal["1.0"]
    users: list[DemoUser]

    @model_validator(mode="after")
    def unique_users(self):
        if len({user.username for user in self.users}) != len(self.users):
            raise ValueError("Duplicate username")
        return self


class Todo(ConfigModel):
    todolistID: str = Field(min_length=1, max_length=128)
    todotype: Literal["overdue-loan", "document-debt", "password-change"]
    loanAccount: str | None = Field(default=None, min_length=1, max_length=64)
    business: str | None = Field(default=None, min_length=1, max_length=128)
    dueDate: date
    amount: float | None = Field(default=None, gt=0)

    @model_validator(mode="after")
    def required_details(self):
        if self.todotype == "overdue-loan" and not self.loanAccount:
            raise ValueError("Overdue loan requires loanAccount")
        if self.todotype == "document-debt" and not self.business:
            raise ValueError("Document debt requires business")
        if self.todotype != "overdue-loan" and (self.loanAccount or self.amount is not None):
            raise ValueError("Loan details only apply to overdue loans")
        if self.todotype != "document-debt" and self.business:
            raise ValueError("Business only applies to document debt")
        return self


class CustomerData(ConfigModel):
    todoList: list[Todo] = Field(default_factory=list, max_length=1000)
    offeringIds: list[str] = Field(default_factory=list, max_length=100)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({todo.todolistID for todo in self.todoList}) != len(self.todoList):
            raise ValueError("Duplicate todo id")
        accounts = [todo.loanAccount for todo in self.todoList if todo.todotype == "overdue-loan"]
        if len(set(accounts)) != len(accounts):
            raise ValueError("Duplicate loan account")
        if len(set(self.offeringIds)) != len(self.offeringIds):
            raise ValueError("Duplicate offering id")
        if any(not item.strip() or len(item) > 128 for item in self.offeringIds):
            raise ValueError("Invalid offering id")
        return self


class DataConfig(ConfigModel):
    version: Literal["1.0"]
    customers: dict[str, CustomerData]

    @field_validator("customers")
    @classmethod
    def customer_keys(cls, value):
        if any(not key or key != key.strip() or len(key) > 128 for key in value):
            raise ValueError("Invalid customer username")
        return value


class AssistantDataStore:
    def __init__(self, users_path: Path, data_path: Path):
        self.users_path, self.data_path = users_path, data_path
        self.lock = RLock()
        self.sessions: dict[str, dict] = {}
        self.profiles: dict[str, dict] = {}
        self.reload()

    def reload(self):
        # Validate both files before swapping either active configuration.
        users = UsersConfig.model_validate(yaml.safe_load(self.users_path.read_text(encoding="utf-8")))
        data = DataConfig.model_validate(yaml.safe_load(self.data_path.read_text(encoding="utf-8")))
        with self.lock:
            self.users, self.data = users, data

    def create_session(self, session_id: str, username: str) -> str:
        username = username.strip().lower()
        with self.lock:
            user = next((item for item in self.users.users if item.username == username), None)
            pronoun = "anh" if user and user.gender == "Nam" else "chị" if user and user.gender == "Nữ" else "anh/chị"
            address = f"{pronoun} {user.name}" if user and pronoun != "anh/chị" else pronoun
            customer = self.data.customers.get(username, CustomerData())
            self.profiles[session_id] = {"username": username, "user_email": user.user_email if user else "", "CIF_Number": user.CIF_Number if user else "", "fullName": (user.fullName or user.name) if user else "Khách hàng", "phoneNumber": user.phoneNumber if user else "", "companyName": user.companyName if user else ""}
            self.sessions[session_id] = {
                "sessionId": session_id,
                "recipient": {"address": address, "pronoun": pronoun},
                **customer.model_dump(mode="json"),
                "capturedAt": datetime.now(UTC).isoformat(),
            }
            return (user.fullName or user.name) if user else "Khách hàng"

    def list_users(self) -> list[dict[str, str]]:
        """Return the non-sensitive demo identities shown by demo clients."""
        with self.lock:
            return [user.model_dump(include={"username", "name", "gender"}) for user in self.users.users]

    def get(self, session_id: str, details: bool = False) -> dict:
        with self.lock:
            result = deepcopy(self.sessions[session_id])
        result["capturedAt"] = datetime.now(UTC).isoformat()
        if details:
            counts = {kind: sum(todo["todotype"] == kind for todo in result["todoList"])
                      for kind in ("overdue-loan", "document-debt", "password-change")}
            result["statistics"] = {"total": len(result["todoList"]), "byType": counts}
        else:
            result["todoList"] = [{"id": todo["todolistID"], "todoType": todo["todotype"],
                                   **{key: value for key, value in todo.items()
                                      if key not in ("todolistID", "todotype") and value is not None}}
                                  for todo in result["todoList"]]
        return result

    def delete(self, session_id: str):
        with self.lock:
            self.sessions.pop(session_id, None)
            self.profiles.pop(session_id, None)

    def support_profile(self, session_id: str) -> dict:
        self.reload()
        with self.lock:
            profile = deepcopy(self.profiles[session_id])
            profile["address"] = self.sessions[session_id]["recipient"]["address"]
            user = next((item for item in self.users.users if item.username == profile["username"]), None)
            if user:
                profile.update(fullName=user.fullName or user.name, phoneNumber=user.phoneNumber, companyName=user.companyName, user_email=user.user_email, CIF_Number=user.CIF_Number)
            return profile
