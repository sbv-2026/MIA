# Deploy MIAAssistant lên GreenNode Agent Runtime

Dùng PowerShell trên Windows và Docker Desktop ở chế độ Linux containers.
Image có tên `mia-assistant`, gồm Assistant Web và Agent API. DemoMSBWeb deploy riêng.

## 1. Lấy đúng địa chỉ project trên GreenNode

Mở Container Registry → chọn project đích → phần **Lệnh push Docker**.
Copy địa chỉ đích từ lệnh **Gắn tag image cho project này**, có dạng:

```text
vcr.vngcloud.vn/111480-abp114583/mia-assistant:<TAG>
```

Phân biệt:

- Username đăng nhập: `111480-gui114583`, lấy từ `deploy.md`.
- PROJECT: `111480-abp114583`, đã xác nhận từ ảnh lệnh push trên GreenNode.
- Image: `mia-assistant`.
- TAG: phiên bản image, ví dụ `demo-20260918-150000`.

Bạn đã push vào `111480-gui114583/mia-assistant` và nhận `401 Unauthorized`.
Địa chỉ này dùng nhầm username làm namespace. Project đúng theo ảnh console là
`111480-abp114583`. Dùng project này để tag/push. Nếu vẫn lỗi 401, kiểm tra quyền
push của tài khoản vào project. Không cần Podman hoặc Helm cho ứng dụng này.

## 2. Đăng nhập một lần

Bạn đã login thành công trên máy này nên có thể bỏ qua bước này.

```powershell
docker login vcr.vngcloud.vn --username 111480-gui114583
```

Nhập secret từ `deploy.md` khi Docker hỏi Password. Docker Desktop lưu credentials;
không cần nhập lại mỗi lần build/push. Chỉ login lại nếu đổi/thu hồi secret,
logout hoặc credentials không còn hợp lệ. Login thành công không đảm bảo quyền push mọi project.

## 3. Build → tag → push

File `Dockerfile.greennode` đã được chuẩn bị trong dự án, chạy Uvicorn ở **8080**.
Dockerfile mặc định vẫn dùng **8000** cho local/Compose.

Chạy cùng một phiên PowerShell; project đã được điền theo ảnh console của bạn:

```powershell
Set-Location 'G:\AI\MSB Hackathon\MIAAssistant'
$registryProject = '111480-abp114583'
$releaseTag = 'demo-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$targetImage = "vcr.vngcloud.vn/${registryProject}/mia-assistant:${releaseTag}"

# Đồng bộ kịch bản Host vào image MIA.
Copy-Item '..\DemoMSBWeb\config\mia-scenarios.yaml' '.\config\demo-mia-scenarios.yaml' -ErrorAction Stop

# Build image local chạy cổng 8080.
docker build --platform linux/amd64 -f Dockerfile.greennode -t mia-assistant:latest .
if ($LASTEXITCODE -ne 0) { throw 'Build thất bại; dừng tại đây' }

# Tag phải chạy lại sau mỗi lần build.
docker tag mia-assistant:latest $targetImage
if ($LASTEXITCODE -ne 0) { throw 'Tag thất bại; dừng tại đây' }

# Push bằng credentials đã lưu, không cần login lại.
docker push $targetImage
if ($LASTEXITCODE -ne 0) { throw 'Push thất bại; xem lỗi registry bên trên' }

Write-Output "Image URL: $targetImage"
```

Build tạo/cập nhật `mia-assistant:latest`. Tag tạo tên registry cho đúng image đó.
Push tải image lên registry. Lưu Image URL và digest sha256 từ output.
Giữ image local tên latest nhưng dùng tag phiên bản mới trên registry để tránh cache khi redeploy.

## 4. Kiểm tra local

Chạy trong một terminal:

```powershell
docker run --rm --name mia-assistant-test -p 8090:8080 --env-file .env mia-assistant:latest
```

Mở PowerShell khác:

```powershell
Invoke-RestMethod 'http://localhost:8090/health'
Start-Process 'http://localhost:8090/assistant/'
```

Kết quả health: `status: ok`. Assistant Web phải tải được. Ctrl+C để dừng container.
MIA không dùng các endpoint `/info`, `/invocations` của agent-hr.

## 5. Tạo Agent Runtime

GreenNode AI Platform → Agent Runtime → Deploy a new Agent → Custom Agent.

| Trường | Giá trị |
|---|---|
| Runtime name | `mia-assistant` |
| Image URL | URL in ra sau push |
| Image authentication | Bật với registry private |
| Registry username | `111480-gui114583` |
| Registry password | Secret từ `deploy.md` |
| Container port, nếu có | `8080` |
| Health-check path, nếu có | `/health` |
| Min/Max replicas | `1 / 1` cho demo |

Đề xuất khởi đầu: 2 CPU, 4 GB RAM; ứng dụng gọi model bên ngoài nên không cần GPU.
Credentials pull của Runtime được cấu hình riêng; login Docker trên laptop không tự cấu hình Runtime.

Nhập biến môi trường, lấy giá trị model thực tế từ `.env`:

```dotenv
ADVISORY_KNOWLEDGE_CONFIG=/app/config/knowledge/advisory-knowledge.yaml
MIA_SCENARIO_CONFIG=/app/config/demo-mia-scenarios.yaml
MIA_SUPPORT_DB=/app/data/support.sqlite3
MIA_MODEL_PROVIDER=<provider>
MIA_MODEL_BASE_URL=<base-url>
MIA_MODEL_API_KEY=<api-key>
MIA_MODEL_NAME=<model>
MIA_MODEL_API_STYLE=<chat-completions-hoac-responses>
MIA_MODEL_TIMEOUT_SECONDS=45
```

Thay các giá trị trong dấu <> trước khi lưu. Thêm biến SMTP/Zalo từ `.env.example`
nếu cần gửi hỗ trợ. Runtime không tự đọc `.env` trên laptop. MIA cho phép mọi host
gọi API và nhúng iframe; không cần ALLOWED_HOST_ORIGINS.

MIA trả redirect từ `/` sang `/assistant/`. Nếu Runtime cố định probe tại `/` và
không chấp nhận redirect, cần sửa route/probe; Docker HEALTHCHECK không thay thế
probe riêng của nền tảng. SQLite cần mount storage bền vững tại `/app/data` nếu
muốn giữ yêu cầu hỗ trợ qua redeploy.

## 6. Kiểm tra public và nối DemoMSBWeb

Sau khi Runtime ACTIVE, dùng endpoint HTTPS thực tế:

```powershell
$miaOrigin = 'https://<endpoint-mia>'
Invoke-RestMethod "$miaOrigin/health"
Start-Process "$miaOrigin/assistant/"
```

Trong môi trường chạy DemoMSBWeb:

```dotenv
ASSISTANT_URL=https://<endpoint-mia>/assistant/
MIA_SUPPORT_ASSISTANT_API_URL=https://<endpoint-mia>
```

Restart/redeploy DemoMSBWeb để áp dụng. Không dùng localhost nối hai runtime.
Thử giao dịch với tài khoản `999000000001`, mở MIA và chọn **Làm rõ thêm** để kiểm
tra kịch bản và SSE/model. Nếu endpoint bắt buộc Bearer token cho mọi request,
cần cấu hình truy cập phù hợp cho iframe; không nhúng secret vào frontend.

## 7. Những lần cập nhật sau

Chạy lại bước 3 (không login lại), sau đó Edit Runtime → đổi Image URL sang URL
mới → lưu/deploy. Push không tự cập nhật Runtime đang chạy.

## Chẩn đoán lỗi

### Image chạy local nhưng Agent Runtime báo lỗi

Kiểm tra đúng image vừa push, không chỉ container Compose trên laptop:

```powershell
docker image inspect mia-assistant:runtime-fix --format 'Arch={{.Architecture}} User={{.Config.User}} Cmd={{json .Config.Cmd}}'
docker run --rm --name mia-runtime-check -p 18092:8080 mia-assistant:runtime-fix
```

Terminal khác: `Invoke-RestMethod http://localhost:18092/health`. Image GreenNode phải chạy cổng 8080. Image local/Compose mặc định chạy 8000 và không thể dùng thay cho bản GreenNode nếu nền tảng cố định probe 8080.

Nếu log có `PermissionError: [Errno 13] Permission denied: 'data'`, đặt biến runtime `MIA_SUPPORT_DB=/app/data/support.sqlite3`. Dockerfile đã đặt mặc định này; `/app/data` được cấp quyền cho user miaassistant. Biến này trước đây chỉ được Compose cung cấp, nên chạy image trực tiếp không có cấu hình có thể dừng ngay khi import app. Nếu mount storage vào `/app/data`, storage cũng phải cho UID 10001 ghi dữ liệu.

Runtime không tự nhận `.env` trên laptop. Nhập các biến GLM/SMTP/Zalo trong cấu hình runtime. Với registry private phải bật Image authentication và cung cấp tài khoản có quyền pull. Push tag mới, rồi chọn đúng URL/tag mới khi tạo hoặc sửa runtime. Nếu vẫn lỗi, đối chiếu log để phân biệt lỗi pull image, lỗi khởi động ứng dụng và lỗi health probe.

| Lỗi | Cách xử lý |
|---|---|
| No such image | Source tag phải tồn tại; bước 3 dùng `mia-assistant:latest` nhất quán |
| 401 Unauthorized / denied | Kiểm tra PROJECT đúng lệnh console và tài khoản có quyền push; không dùng username thay project |
| Tag does not exist | Chạy docker tag với đúng `$targetImage` trước push |
| docker-credential-desktop not found | Kiểm tra Docker Desktop/credential helper, mở lại terminal |
| Runtime lỗi sau khi pull | Kiểm tra logs, biến model/config, cổng 8080 và health probe |

Không commit `.env` hoặc `deploy.md` vì chứa secret. Dockerfile COPY chọn lọc;
không thêm `COPY . .` khi chưa loại trừ credential files trong `.dockerignore`.

Tham khảo: [GreenNode hướng dẫn Custom Agent Runtime, registry authentication và cổng 8080](https://greennode.ai/tutorial/guide-to-deploy-nemoclaw-on-greennode-agentbase).
