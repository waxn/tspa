from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    password_hash: str = ""
    secret_key: str = "change-me"
    tz: str = "America/New_York"
    database_url: str = "sqlite:///./tspa.db"
    openrouter_api_key: str = ""
    openrouter_model: str = ""
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:you@example.com"


@lru_cache
def get_settings() -> Settings:
    return Settings()
