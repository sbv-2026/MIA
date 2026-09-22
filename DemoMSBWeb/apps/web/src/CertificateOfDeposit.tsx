import { useState } from "react";
import "./certificate-of-deposit.css";

const sections = [
  {
    title: "Đặc tính sản phẩm",
    lines: [
      "Chứng chỉ tiền gửi là giấy tờ có giá do MSB phát hành, có giá trị và được bảo đảm an toàn với mức sinh lời hấp dẫn:",
      "Giá trị đầu tư tối thiểu 110.000.000 VND",
      "Linh hoạt chuyển đổi sử dụng khi cần",
      "Lợi nhuận tính theo số ngày nắm giữ thực tế",
      "Giao dịch trực tuyến dễ dàng trên ứng dụng MSB Business Banking",
      "Không phát sinh thuế, phí",
    ],
  },
  {
    title: "Điều kiện tham gia",
    lines: [
      "Doanh nghiệp đang hoạt động tại Việt Nam, không nằm trong danh sách cảnh báo nghi ngờ",
      "Người đại diện hợp pháp sử dụng chữ ký số để giao dịch",
      "Có tài khoản thanh toán tại MSB",
    ],
  },
  {
    title: "Thời gian giao dịch",
    lines: [
      "Giao dịch từ thứ hai tới thứ sáu (8h - 17h), trừ các ngày nghỉ, lễ, tết theo quy định của pháp luật và MSB",
      "Người duyệt cần xác nhận trong vòng 1 giờ kể từ khi nhận được yêu cầu",
    ],
  },
];

function CertificateArt() {
  return <svg className="certificate-art" viewBox="0 0 220 150" role="img" aria-label="Chứng chỉ tiền gửi">
    <path d="M25 44h125v86H15z" fill="#fff7ec" stroke="#f5c990" strokeWidth="2"/>
    <path d="M38 68h76M38 84h60M38 100h46" stroke="#9aa3ad" strokeWidth="3"/>
    <path d="M75 116c20-8 29-9 45-4" fill="none" stroke="#12345b" strokeWidth="3"/>
    <circle cx="143" cy="42" r="29" fill="#ffab50" stroke="#fff" strokeWidth="4"/>
    <text x="143" y="54" textAnchor="middle" fontSize="34" fill="white">$</text>
    <path d="M126 66l9 57 17-17 17 17 4-61" fill="#667585" opacity=".85"/>
    <path d="M164 96h39v34h-39z" fill="#485968"/><path d="M170 89h26v14h-26z" fill="#ff7a32"/>
    <text x="77" y="58" textAnchor="middle" fontSize="12" fill="#738092">CERTIFICATE</text>
  </svg>;
}

export function CertificateOfDeposit() {
  const [expanded, setExpanded] = useState(0);
  return <div className="page certificate-page">
    <header className="certificate-heading"><span>‹</span><h1>Khám phá</h1></header>
    <section className="card certificate-hero">
      <CertificateArt/>
      <h2>ĐẦU TƯ AN TOÀN,<br/>CHUYỂN NHƯỢNG LINH HOẠT</h2>
      <div className="certificate-benefits">
        <div><b>♨</b><p>Sinh lời mỗi ngày, lợi suất<br/>lên tới <strong>7.5%/năm</strong></p></div>
        <div><b>⇄</b><p>Thời gian nắm giữ<br/><strong>linh hoạt</strong></p></div>
        <div><b>♢</b><p>Giao dịch <strong>100% online</strong>,<br/>an toàn và bảo mật</p></div>
      </div>
      <button className="primary-button">Sở hữu ngay</button>
    </section>
    <section className="certificate-accordions">{sections.map((section, index) => <article className="card" key={section.title}>
      <button onClick={() => setExpanded(expanded === index ? -1 : index)} aria-expanded={expanded === index}><strong>{section.title}</strong><span>{expanded === index ? "⌃" : "⌄"}</span></button>
      {expanded === index && <div>{section.lines.map((line, lineIndex) => lineIndex === 0 && index === 0 ? <p key={line}>{line}</p> : <p className="certificate-line" key={line}><span>✓</span>{line}</p>)}</div>}
    </article>)}</section>
  </div>;
}
