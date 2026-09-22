# Deployment

`compose.yaml` chạy Assistant độc lập tại cổng 8090. `deploy/integration-compose.yaml` pin hai image `0.1.0` và chạy DemoMSBWeb tại 8081.

```powershell
docker compose build
docker compose up -d
docker compose -f deploy/integration-compose.yaml up -d
```

MIA cho phép mọi host gọi API và nhúng iframe; không cần cấu hình origin.
