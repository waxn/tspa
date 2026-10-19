from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    password_hash: str = ""
    password_file: str = ""  # alternative to PASSWORD_HASH: a file holding the hash (used in Docker)
    secret_key: str = "change-me"
    https_only: bool = False  # set true when served over HTTPS
    tz: str = "America/New_York"
    database_url: str = "sqlite:///./tspa.db"
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:you@example.com"


def stored_password_hash() -> str:
    s = get_settings()
    if s.password_hash:
        return s.password_hash
    if s.password_file:
        try:
            return Path(s.password_file).read_text().strip()
        except OSError:
            return ""
    return ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
