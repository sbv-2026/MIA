from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from .models import DisbursementRequest


class ScenarioConfigError(RuntimeError):
    pass


@dataclass(frozen=True)
class ScenarioResult:
    scenario_id: str
    outcome: str
    beneficiary_name: str | None = None
    error_code: str | None = None
    field: str | None = None
    message: str | None = None
    title: str | None = None


class DisbursementScenarioEngine:
    """Validation rules backed by YAML and hot-reloaded on every interaction."""

    def __init__(self, path: Path):
        self.path = path
        self._load()

    def _load(self) -> dict[str, Any]:
        try:
            payload = yaml.safe_load(self.path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, yaml.YAMLError) as exc:
            raise ScenarioConfigError(f"Unable to load demo scenarios: {exc}") from exc
        if not isinstance(payload, dict) or payload.get("version") != "2.0":
            raise ScenarioConfigError("Scenario config must have version 2.0")
        inline = payload.get("inlineErrors")
        popup = payload.get("popupErrors", {}).get("continue")
        success = payload.get("successRules")
        beneficiaries = payload.get("beneficiaries")
        if not isinstance(inline, dict) or not isinstance(popup, list) or not isinstance(success, list) or not isinstance(beneficiaries, dict):
            raise ScenarioConfigError("Config requires beneficiaries, inlineErrors, popupErrors.continue and successRules")
        for account_number, beneficiary in beneficiaries.items():
            if not str(account_number).isdigit() or not isinstance(beneficiary, dict) or not beneficiary.get("beneficiaryName"):
                raise ScenarioConfigError(f"Invalid beneficiary account: {account_number}")
        ids: set[str] = set()
        for rules in [*inline.values(), popup, success]:
            if not isinstance(rules, list):
                raise ScenarioConfigError("Every error collection must be a list")
            for rule in rules:
                if not isinstance(rule, dict) or not isinstance(rule.get("id"), str):
                    raise ScenarioConfigError("Every rule requires an id")
                if rule["id"] in ids:
                    raise ScenarioConfigError(f"Duplicate scenario id: {rule['id']}")
                ids.add(rule["id"])
                if "priority" not in rule or not isinstance(rule["priority"], int):
                    raise ScenarioConfigError(f"Rule {rule['id']} requires an integer priority")
        for field, rules in inline.items():
            for rule in rules:
                if rule.get("field") != field or not all(key in rule for key in ("value", "errorCode", "message", "matcher")):
                    raise ScenarioConfigError(f"Invalid inline rule {rule['id']} for {field}")
        for rule in popup:
            if not all(key in rule for key in ("errorCode", "title", "message", "match")):
                raise ScenarioConfigError(f"Invalid popup rule {rule['id']}")
            if not str(rule["errorCode"]).isdigit():
                raise ScenarioConfigError(f"Popup errorCode must be numeric in {rule['id']}")
        return payload

    def public_config(self) -> dict[str, Any]:
        payload = self._load()
        return {
            "version": payload["version"],
            "operation": payload["operation"],
            "inlineErrors": payload["inlineErrors"],
            "popupErrors": payload["popupErrors"],
        }

    def find_beneficiary(self, account_number: str) -> str | None:
        beneficiary = self._load()["beneficiaries"].get(account_number)
        return str(beneficiary["beneficiaryName"]) if beneficiary else None

    @staticmethod
    def _matches(match: dict[str, Any], request: DisbursementRequest) -> bool:
        if "accountNumber" in match and str(match["accountNumber"]) != request.account_number:
            return False
        if "content" in match and str(match["content"]) != request.content:
            return False
        if "contentContains" in match and str(match["contentContains"]).casefold() not in request.content.casefold():
            return False
        if "contentContainsAny" in match and not any(character in request.content for character in str(match["contentContainsAny"])):
            return False
        if "amountEquals" in match and request.amount != int(match["amountEquals"]):
            return False
        if "minAmountInclusive" in match and request.amount < int(match["minAmountInclusive"]):
            return False
        if "maxAmountExclusive" in match and request.amount >= int(match["maxAmountExclusive"]):
            return False
        return True

    def evaluate(self, request: DisbursementRequest) -> ScenarioResult:
        payload = self._load()
        beneficiary_name = self.find_beneficiary(request.account_number)
        if beneficiary_name is None:
            return ScenarioResult(
                scenario_id="account-not-found", outcome="error", error_code="11001",
                message="Không tìm thấy tài khoản thụ hưởng tại MSB.",
                title="Không tìm thấy tài khoản thụ hưởng",
                field="accountNumber",
            )
        popup_rules = sorted(payload["popupErrors"]["continue"], key=lambda rule: rule["priority"], reverse=True)
        for rule in popup_rules:
            if self._matches(rule["match"], request):
                return ScenarioResult(
                    scenario_id=rule["id"], outcome="error", error_code=str(rule["errorCode"]),
                    message=rule["message"], title=rule["title"],
                )
        success_rules = sorted(payload["successRules"], key=lambda rule: rule["priority"], reverse=True)
        for rule in success_rules:
            if self._matches(rule.get("match", {}), request):
                return ScenarioResult(
                    scenario_id=rule["id"], outcome="success", beneficiary_name=beneficiary_name,
                )
        raise ScenarioConfigError("No demo scenario matched the request")
