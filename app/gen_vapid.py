import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


if __name__ == "__main__":
    key = ec.generate_private_key(ec.SECP256R1())
    priv = b64(key.private_numbers().private_value.to_bytes(32, "big"))
    pub = b64(key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint))
    print(f"VAPID_PRIVATE_KEY={priv}\nVAPID_PUBLIC_KEY={pub}")
