# DemoMSBWeb

DemoMSBWeb là ứng dụng mô phỏng MSB Business Banking, tích hợp trợ lý MIA để trình diễn các luồng tư vấn lỗi, hỗ trợ giao dịch, bóc tách PO và trải nghiệm cá nhân hóa bằng giọng nói.

Host DemoMSBWeb và demo banking API dùng chung cho Web/Mobile. Host không chứa phần triển khai Agent và vẫn hoạt động khi `MIAAssistant` tắt.

## Truy cập bản demo

Mở DemoMSBWeb qua endpoint GreenNode:

<https://endpoint-a33d7196-2514-483c-bfc5-a10e931a22c1.agentbase-runtime.aiplatform.vngcloud.vn/>

### Trình duyệt và âm thanh

- Trên máy tính:
  - Dùng Microsoft Edge để nghe giọng đọc mặc định.
  - Dùng Google Chrome để nghe giọng nam/nữ tương ứng với từng người dùng.
- Trên điện thoại: mở liên kết bằng Google Chrome để phát được âm thanh.

## Đăng nhập

Sử dụng một trong các tài khoản sau:

| Tên đăng nhập | Mật khẩu |
| --- | --- |
| `erik` | Giá trị bất kỳ |
| `huong` | Giá trị bất kỳ |
| `huy` | Giá trị bất kỳ |
| `sobv` | Giá trị bất kỳ |
| `ly` | Giá trị bất kỳ |

## Các kịch bản demo

### 1. Tư vấn lỗi trong luồng Giải ngân

1. Vào menu **Giải ngân**.
2. Chọn **Thanh toán nội địa**.
3. Tại phần **Bên thụ hưởng [1]**, nhập số tài khoản vào trường **Số tài khoản** để kiểm tra lỗi hiển thị ngay tại trường nhập liệu.
4. Hoặc điền thông tin và nhấn **Tiếp tục** để gửi biểu mẫu; khi có lỗi, hệ thống sẽ hiển thị thông báo lỗi.
5. MIA tự động nhận diện lỗi và mở khung chat để hỗ trợ tương tác.

Trong quá trình trao đổi, anh/chị có thể:

- Nhập thêm nội dung cần hỗ trợ.
- Chụp ảnh màn hình làm bằng chứng (evidence).
- Nhập địa chỉ email cần CC để ghi nhận và gửi thông tin về lỗi của người dùng.

Các số tài khoản tham khảo:

| Kịch bản | Số tài khoản |
| --- | --- |
| Tài khoản hợp lệ | `001100123456` |
| Tài khoản bị khóa (locked) | `999000000002` |

Anh/chị cũng có thể thử các số tài khoản hoặc trường thông tin khác để kiểm tra những kịch bản lỗi khác.

### 2. Tư vấn lỗi trong luồng Bảo lãnh

Vào menu **Bảo lãnh** để hệ thống hiển thị thông báo có mã lỗi. MIA sẽ nhận diện lỗi và hỗ trợ người dùng trong khung chat.

### 3. Bóc tách PO và tạo Đề nghị phát hành L/C

Nếu đang ở một luồng khác, nhấn **Trang chủ** của MIA để quay về màn hình chính, sau đó:

1. Mở khung làm việc của MIA.
2. Chọn chức năng **Thực hiện giao dịch**.
3. Chọn **Phát hành L/C**.
4. Tương tác với MIA và tải lên file PO tham khảo được gửi kèm.
5. Sau khi MIA bóc tách dữ liệu, chọn một trong hai cách:
   - Tiếp tục cung cấp các thông tin còn thiếu cho MIA.
   - Chuyển sang biểu mẫu giao dịch và trực tiếp điền các thông tin không có trong PO.

### 4. Trải nghiệm cá nhân hóa và giọng nói

1. Đăng xuất, sau đó đăng nhập lại.
2. Ngay sau khi đăng nhập, MIA sẽ chủ động thông báo các việc cần làm và gợi ý phù hợp.
3. Nhấn vào bubble/bong bóng chat **MIA** để mở giao diện trợ lý.
4. Có thể dùng giọng nói để đưa ra yêu cầu. Ví dụ: nói **“Tạo yêu cầu giải ngân”**; MIA sẽ xác nhận lại trước khi tiếp tục.
5. Với thông tin về khoản vay quá hạn, có thể nói **“Khoản vay số 1”** hoặc **“Số 1”** để chọn khoản vay đầu tiên.

## Chạy dự án trên máy cục bộ

Yêu cầu: Node.js/npm, Python và Docker.

### Build frontend

```powershell
cd DemoMSBWeb\apps\web
npm ci
npm run build
```

### Cài đặt và kiểm thử demo banking API

```powershell
cd DemoMSBWeb\services\demo-banking-api
python -m pip install -e ".[test]"
python -m pytest
```

### Chạy bằng Docker Compose

```powershell
cd DemoMSBWeb
docker compose up --build
```

Các địa chỉ mặc định:

- DemoMSBWeb: <http://localhost:8081>
- MIA Assistant: <http://localhost:8090>

## Cấu hình dữ liệu demo

Danh sách tài khoản thụ hưởng nằm tại `config/demo-transaction-scenarios.yaml`, mục `beneficiaries`. Mỗi phần tử dùng số tài khoản làm khóa và khai báo `beneficiaryName`. Tài khoản không có trong danh sách nhận mã lỗi `11001`; các tài khoản có trong danh sách vẫn được áp dụng các quy tắc lỗi nghiệp vụ bên dưới. Backend đọc lại file ở mỗi lần tra cứu hoặc gửi lệnh, vì vậy có thể chỉnh dữ liệu demo mà không cần build lại frontend.

Menu sử dụng `lucide-react`. Thứ tự icon được cấu hình trong hằng `MENU_ICONS`, còn thứ tự và nhãn menu nằm trong `SIDEBAR_GROUPS` tại `apps/web/src/App.tsx`. Khi cần đổi icon, import icon mới từ `lucide-react` rồi thay phần tử tương ứng trong `MENU_ICONS`. Xem danh mục icon tại <https://lucide.dev/icons/>.

## Ghi chú về contract

Thư mục `apps/web/vendor` chứa các artifact dùng để bootstrap offline. Không đưa mã nguồn contracts trực tiếp vào Host. Khi chuyển sang dùng GitHub Packages, cập nhật các dependency `file:` sang đúng phiên bản package đã phát hành theo tài liệu versioning của dự án.
