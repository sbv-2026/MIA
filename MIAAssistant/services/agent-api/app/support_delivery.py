"""Consent-based support outbox. Never report delivery for an unconfigured channel."""
import base64
import json
import os
import re
import smtplib
import sqlite3
import ssl
import uuid
from datetime import UTC, datetime
from email.message import EmailMessage
from pathlib import Path
from threading import RLock

import httpx
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from .models import ContextSnapshot


class SupportContact(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    username: str = Field(min_length=1, max_length=128)
    fullName: str = Field(min_length=1, max_length=128)
    phoneNumber: str = Field(default="", max_length=32, pattern=r"^[+\d ()-]*$")
    user_email: str = Field(default="", max_length=254, pattern=r"^$|^[^\s@]+@[^\s@]+\.[^\s@]+$")
    CIF_Number: str = Field(default="", max_length=64)
    companyName: str = Field(default="", max_length=256)
    address: str = Field(default="anh/chị", min_length=1, max_length=128)


class SupportRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sessionId: str = Field(min_length=1, max_length=128)
    contextSnapshot: ContextSnapshot
    contact: SupportContact
    screenshot: str = Field(min_length=1, max_length=6_000_000)
    consent: bool
    screenUrl: str = Field(default="", max_length=2048)
    recipientEmails: list[str] = Field(min_length=1, max_length=10)

    @field_validator("recipientEmails")
    @classmethod
    def valid_recipient_emails(cls, values):
        normalized = [value.strip().lower() for value in values]
        if any(not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value) for value in normalized):
            raise ValueError("RECIPIENT_EMAIL_INVALID")
        if len(set(normalized)) != len(normalized):
            raise ValueError("RECIPIENT_EMAIL_DUPLICATE")
        return normalized

    @model_validator(mode="after")
    def scope(self):
        if self.contextSnapshot.context.session_id != self.sessionId or not self.contextSnapshot.error or self.consent is not True:
            raise ValueError("SUPPORT_CONSENT_AND_ERROR_REQUIRED")
        return self


class SupportOutbox:
    def __init__(self, path=None):
        self.path = Path(path or os.getenv("MIA_SUPPORT_DB", "data/support.sqlite3"))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = RLock()
        with sqlite3.connect(self.path) as db:
            db.execute("CREATE TABLE IF NOT EXISTS tickets (scope TEXT PRIMARY KEY, id TEXT NOT NULL, payload TEXT NOT NULL, statuses TEXT NOT NULL)")

    @staticmethod
    def decode_image(value):
        if not value.startswith("data:image/png;base64,"):
            raise ValueError("SCREENSHOT_PNG_REQUIRED")
        image = base64.b64decode(value.split(",", 1)[1], validate=True)
        if len(image) > 4_000_000 or len(image) < 24 or not image.startswith(b"\x89PNG\r\n\x1a\n") or image[12:16] != b"IHDR":
            raise ValueError("SCREENSHOT_INVALID")
        width, height = int.from_bytes(image[16:20], "big"), int.from_bytes(image[20:24], "big")
        if not (0 < width <= 4096 and 0 < height <= 4096):
            raise ValueError("SCREENSHOT_DIMENSIONS_INVALID")
        return image

    @staticmethod
    def email(payload, image):
        host, recipient = os.getenv("MIA_SUPPORT_SMTP_HOST"), os.getenv("MIA_SUPPORT_EMAIL_TO")
        sender = os.getenv("MIA_SUPPORT_SMTP_USER") or os.getenv("MIA_SUPPORT_EMAIL_FROM")
        if not all((host, recipient, sender)):
            return "pending-configuration"
        message = EmailMessage()
        message["From"], message["To"] = sender, recipient
        message["Reply-To"] = sender
        customer_email = payload["contact"].get("user_email")
        selected_recipients = payload.get("recipientEmails") or ([customer_email] if customer_email else [])
        cc = list(dict.fromkeys(value.lower() for value in selected_recipients if value and value.lower() not in (sender.lower(), recipient.lower())))
        if cc:
            message["Cc"] = ", ".join(cc)
        contact = payload["contact"]
        message["Subject"] = f"CIF {contact.get('CIF_Number', '')}User {contact.get('username', '')}_ErrorCode {payload['errorCode']}_ID MIA {payload['ticketId']}"
        address = contact.get("address") or contact.get("fullName") or "anh/chị"
        introduction = (
            f"Kinh gửi {address},\n\n"
            "MSB xin lỗi vì trải nghiệm chưa tốt trên nền tảng Bussiness Banking. "
            f"Trợ lý MIA ghi nhận phẩn hồi của {address} về lỗi với các thông tin và hình ảnh như đính kèm. "
            "Vui lòng giữ lại email này để theo dõi tiến trình xử lý và hỗ trợ."
        )
        details = json.dumps({key: value for key, value in payload.items() if key != "screenshot"}, ensure_ascii=False, indent=2)
        message.set_content(f"{introduction}\n\n{details}")
        message.add_attachment(image, maintype="image", subtype="png", filename="man-hinh-loi.png")
        port = int(os.getenv("MIA_SUPPORT_SMTP_PORT", "587"))
        mode = os.getenv("MIA_SUPPORT_SMTP_SECURITY", "starttls")
        constructor = smtplib.SMTP_SSL if mode == "ssl" else smtplib.SMTP
        with constructor(host, port, timeout=15) as client:
            if mode == "starttls":
                client.starttls(context=ssl.create_default_context())
            username, password = os.getenv("MIA_SUPPORT_SMTP_USER"), os.getenv("MIA_SUPPORT_SMTP_PASSWORD")
            if username:
                client.login(username, password or "")
            refused = client.send_message(message)
            if refused:
                raise RuntimeError("EMAIL_RECIPIENT_REFUSED")
        return "sent"

    @staticmethod
    def zalo(payload):
        url = os.getenv("MIA_SUPPORT_ZALO_WEBHOOK_URL")
        if not url:
            return "pending-configuration"
        token = os.getenv("MIA_SUPPORT_ZALO_TOKEN")
        headers = {"Idempotency-Key": payload["ticketId"]}
        if token:
            headers["Authorization"] = "Bearer " + token
        response = httpx.post(url, json=payload, headers=headers, timeout=15)
        response.raise_for_status()
        result = response.json()
        if not isinstance(result, dict) or not (result.get("accepted") is True or result.get("error") == 0):
            raise ValueError("ZALO_DELIVERY_NOT_ACKNOWLEDGED")
        return "sent"

    def submit(self, request, state):
        image = self.decode_image(request.screenshot)
        error, context = request.contextSnapshot.error, request.contextSnapshot.context
        scope = json.dumps([request.sessionId, error.error_code])
        with self.lock, sqlite3.connect(self.path) as db:
            row = db.execute("SELECT id,payload,statuses FROM tickets WHERE scope=?", (scope,)).fetchone()
            if row:
                ticket_id, raw, statuses = row
                payload, statuses = json.loads(raw), json.loads(statuses)
                image = self.decode_image(payload["screenshot"])
            else:
                ticket_id = "MIA-" + uuid.uuid4().hex[:12].upper()
                payload = {"ticketId": ticket_id, "sessionId": request.sessionId, "contact": request.contact.model_dump(), "recipientEmails": request.recipientEmails, "screenId": context.screen_id, "screenUrl": request.screenUrl, "function": error.operation, "errorCode": error.error_code, "description": state["description"], "publishedSteps": state["steps"], "conversation": state["history"], "screenshot": request.screenshot, "consentedAt": datetime.now(UTC).isoformat()}
                statuses = {"email": "pending", "zalo": "pending"}
                db.execute("INSERT INTO tickets VALUES(?,?,?,?)", (scope, ticket_id, json.dumps(payload, ensure_ascii=False), json.dumps(statuses)))
                db.commit()
            for channel, deliver in (("email", lambda: self.email(payload, image)), ("zalo", lambda: self.zalo(payload))):
                if statuses[channel] == "sent":
                    continue
                try:
                    statuses[channel] = deliver()
                except (OSError, ValueError, RuntimeError, smtplib.SMTPException, httpx.HTTPError):
                    statuses[channel] = "failed"
                db.execute("UPDATE tickets SET statuses=? WHERE scope=?", (json.dumps(statuses), scope))
                db.commit()
        sent = all(value == "sent" for value in statuses.values())
        return {"ticketId": ticket_id, "channels": statuses, "message": "MIA đã chuyển hồ sơ tới bộ phận hỗ trợ qua email và Zalo. Cảm ơn anh/chị đã cung cấp thông tin." if sent else "MIA đã chuyển hồ sơ qua email tới cán bộ hỗ trợ." if statuses["email"] == "sent" else "MIA đã ghi nhận hồ sơ " + ticket_id + ". Một số kênh gửi chưa hoàn tất; hồ sơ được lưu để tiếp tục chuyển tới bộ phận hỗ trợ."}
