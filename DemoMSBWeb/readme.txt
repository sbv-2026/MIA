DEMOMSBWEB - HƯỚNG DẪN SỬ DỤNG VÀ CHẠY DEMO
================================================

1. TRUY CẬP HỆ THỐNG

Truy cập DemoMSBWeb qua endpoint GreenNode:
https://endpoint-a33d7196-2514-483c-bfc5-a10e931a22c1.agentbase-runtime.aiplatform.vngcloud.vn/

Lưu ý về trình duyệt và âm thanh:

- Trên máy tính:
  + Dùng Microsoft Edge để nghe giọng đọc mặc định.
  + Dùng Google Chrome để nghe giọng nam/nữ tương ứng với từng người dùng.
- Trên điện thoại: mở liên kết bằng Google Chrome để phát được âm thanh.

2. ĐĂNG NHẬP

- Nhập một trong các tên đăng nhập sau: erik, huong, huy, sobv hoặc ly.
- Mật khẩu có thể là giá trị bất kỳ.

3. DEMO LUỒNG TƯ VẤN LỖI

3.1. Luồng Giải ngân

1) Vào menu "Giải ngân".
2) Chọn "Thanh toán nội địa".
3) Tại phần "Bên thụ hưởng [1]", nhập số tài khoản vào trường "Số tài khoản" để kiểm tra lỗi hiển thị ngay tại trường nhập liệu.
4) Hoặc điền thông tin và nhấn "Tiếp tục" để gửi biểu mẫu; khi có lỗi, hệ thống sẽ hiển thị thông báo lỗi.
5) MIA tự động nhận diện lỗi và mở khung chat để hỗ trợ tương tác.

Trong quá trình trao đổi, anh/chị có thể:

- Nhập thêm nội dung cần hỗ trợ.
- Chụp ảnh màn hình làm bằng chứng (evidence).
- Nhập địa chỉ email cần CC để ghi nhận và gửi thông tin về lỗi của người dùng.

Các số tài khoản tham khảo:

- Tài khoản hợp lệ: 001100123456
- Tài khoản bị khóa (locked): 999000000002
- Có thể thử các số tài khoản hoặc trường thông tin khác để kiểm tra những kịch bản lỗi khác.

3.2. Luồng Bảo lãnh

Vào menu "Bảo lãnh" để hệ thống hiển thị thông báo có mã lỗi. MIA sẽ nhận diện lỗi và hỗ trợ người dùng trong khung chat.

4. DEMO BÓC TÁCH PO VÀ TẠO ĐỀ NGHỊ PHÁT HÀNH L/C

Nếu đang ở một luồng khác, nhấn "Trang chủ" của MIA để quay về màn hình chính, sau đó:

1) Mở khung làm việc của MIA.
2) Chọn chức năng "Thực hiện giao dịch".
3) Chọn "Phát hành L/C".
4) Tương tác với MIA và tải lên file PO tham khảo được gửi kèm.
5) Sau khi MIA bóc tách dữ liệu, chọn một trong hai cách:
   - Tiếp tục cung cấp các thông tin còn thiếu cho MIA; hoặc
   - Chuyển sang biểu mẫu giao dịch và trực tiếp điền các thông tin không có trong PO.

5. DEMO TRẢI NGHIỆM CÁ NHÂN HÓA VÀ GIỌNG NÓI

1) Đăng xuất, sau đó đăng nhập lại.
2) Ngay sau khi đăng nhập, MIA sẽ chủ động thông báo các việc cần làm và gợi ý phù hợp.
3) Nhấn vào bubble/bong bóng chat "MIA" để mở giao diện trợ lý.
4) Có thể dùng giọng nói để đưa ra yêu cầu. Ví dụ: nói "Tạo yêu cầu giải ngân"; MIA sẽ xác nhận lại trước khi tiếp tục.
5) Với thông tin về khoản vay quá hạn, có thể nói "Khoản vay số 1" hoặc "Số 1" để chọn khoản vay đầu tiên.

6. CHẠY DỰ ÁN TRÊN MÁY CỤC BỘ

Yêu cầu: Node.js/npm, Python và Docker.

Frontend:

  cd DemoMSBWeb\apps\web
  npm ci
  npm run build

Demo banking API và kiểm thử:

  cd DemoMSBWeb\services\demo-banking-api
  python -m pip install -e ".[test]"
  python -m pytest

Chạy bằng Docker Compose:

  cd DemoMSBWeb
  docker compose up --build

Địa chỉ mặc định khi chạy cục bộ:

- DemoMSBWeb: http://localhost:8081
- MIA Assistant: http://localhost:8090

