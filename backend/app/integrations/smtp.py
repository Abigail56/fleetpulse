import smtplib
from email.message import EmailMessage

from app.core.config import Settings

SMTP_TIMEOUT_SECONDS = 10


def send_via_smtp(settings: Settings, to: str, subject: str, body: str) -> None:
    if not settings.smtp_host:
        raise RuntimeError("smtp_host is not configured")

    message = EmailMessage()
    message["From"] = settings.email_from
    message["To"] = to
    message["Subject"] = subject
    message.set_content(body)

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=SMTP_TIMEOUT_SECONDS) as smtp:
        if settings.smtp_starttls:
            smtp.starttls()
        if settings.smtp_username and settings.smtp_password:
            smtp.login(settings.smtp_username, settings.smtp_password.get_secret_value())
        smtp.send_message(message)
