import { useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeftRight, BadgeDollarSign, Banknote, BookOpenCheck, Boxes, Building2, ChevronDown, ChevronUp, CircleDollarSign, CreditCard, FileBadge, Files, FileText, Gauge, HandCoins, HomeIcon, Landmark, Menu, MoreHorizontal, Package, QrCode, ReceiptText, Search, Send, ShieldCheck, SlidersHorizontal, Users, UsersRound, WalletCards, X } from "lucide-react";
import { DisbursementForm } from "./DisbursementForm";
import { CreditInformation } from "./CreditInformation";
import { TodoDestination } from "./TodoDestination";
import { CertificateOfDeposit } from "./CertificateOfDeposit";
import { LetterOfCreditDashboard, LetterOfCreditForm, LetterOfCreditSuccess, type LcDraft, type LetterOfCreditView } from "./LetterOfCredit";
import "./credit.css";
import { AssistantLauncher } from "./AssistantLauncher";
import "./styles.css";
import "./mia-glass.css";
import type { ScreenContext, NavigationTarget } from "@mia/contracts";

type View = "credit-information" | "documents-management" | "password-change" | "certificate-of-deposit" | "login" | "home" | "disbursement" | "create-disbursement" | "review" | "domestic-transfer" | LetterOfCreditView;
type AppError = { errorId: string; errorCode: string; scenarioId: string; field: string | null; title?: string | null; message: string; operation?: string };
type GuaranteeErrorConfig = { enabled: boolean; feature?: string; operation?: string; error?: { errorCode: string; title: string; message: string } };

const PURPOSES = ["Hàng hóa, dịch vụ có hóa đơn", "Thanh toán nghĩa vụ với nhà nước", "Mua bất động sản", "Khác"];
const SIDEBAR_GROUPS = [
  ["TÀI KHOẢN", "Quản lý tài khoản", "Tiền gửi và đầu tư", "Quản lý dòng tiền", "Danh bạ thụ hưởng"],
  ["CHUYỂN KHOẢN & THANH TOÁN", "Chuyển khoản trong nước", "Giao dịch ngoại tệ", "Thanh toán dịch vụ", "Thanh toán lương"],
  ["TÍN DỤNG", "Đề xuất cấp hạn mức", "Quản lý thông tin tín dụng", "Giải ngân", "Bảo lãnh", "Thư tín dụng (L/C nhập)"],
  ["TRUNG TÂM QUẢN TRỊ", "Gói dịch vụ", "Phân quyền tài khoản", "Quy trình duyệt", "Phân quyền người dùng"],
  ["DỊCH VỤ KHÁC", "Tài khoản định danh", "Kết nối phần mềm kế toán", "Tra soát", "Quản lý chứng từ"],
];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

function Logo() { return <div className="logo" aria-label="MSB"><span className="logo-mark">M</span><b>MSB</b></div>; }

function Login({ onLogin }: { onLogin: (username: string) => Promise<void> }) {
  const [username, setUsername] = useState(""); const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!username.trim() || !password) return setError("Vui lòng nhập tên đăng nhập và mật khẩu."); setBusy(true); setError(""); try { await onLogin(username); } catch { setError("Không thể khởi tạo phiên demo. Vui lòng thử lại."); } finally { setBusy(false); } };
  return <main className="login-page"><section className="login-art" aria-label="MSB Business Banking"><div className="sky-glow"/><div className="building-grid"/><div className="login-art-copy"><span>MSB Business Banking</span><strong>Đồng hành cùng doanh nghiệp</strong></div></section><section className="login-panel"><header className="login-header"><Logo/><nav><span>▣ Tải ứng dụng</span><span>▤ Hướng dẫn sử dụng</span><span>🇻🇳⌄</span></nav></header><form className="login-form" onSubmit={submit}><h1>Đăng nhập</h1><p>MSB Business Banking</p><label>Tên đăng nhập<input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Nhập tên đăng nhập" autoFocus/></label><label>Mật khẩu <a href="#forgot" onClick={(e) => e.preventDefault()}>Quên mật khẩu</a><input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Nhập mật khẩu" type="password"/></label>{error && <div className="login-error" role="alert">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? "Đang đăng nhập…" : "Đăng nhập"}</button><div className="open-account">Chưa có tài khoản? <b>Mở tài khoản doanh nghiệp</b></div></form><footer>© 2026 Ngân hàng TMCP Hàng Hải Việt Nam (MSB) <b>Điều khoản & Điều kiện</b></footer></section></main>;
}

const MENU_ICONS = [WalletCards, Landmark, ReceiptText, Banknote, BadgeDollarSign, FileText, HandCoins, ShieldCheck, FileBadge, CircleDollarSign, CreditCard, Package, Users, Gauge, Boxes, BookOpenCheck];
function Sidebar({ view, navigate, open, onClose, onGuarantee }: { view: View; navigate: (view: View) => void; open: boolean; onClose: () => void; onGuarantee: () => void }) {
  const navRef = useRef<HTMLDivElement>(null);
  const [collapsedGroups, setCollapsedGroups] = useState(() => new Set(["TRUNG TÂM QUẢN TRỊ", "DỊCH VỤ KHÁC"]));
  const isLc = ["letter-of-credit", "lc-issue", "lc-amend", "lc-success"].includes(view);
  const go = (next: View) => { navigate(next); onClose(); };
  const toggleGroup = (title: string) => setCollapsedGroups((current) => {
    const next = new Set(current);
    if (next.has(title)) next.delete(title); else next.add(title);
    return next;
  });
  let iconIndex = 0;
  return <><div className={open ? "sidebar-backdrop open" : "sidebar-backdrop"} onClick={onClose}/><aside className={open ? "sidebar open" : "sidebar"}>
    <div className="sidebar-heading"><Logo/><button className="sidebar-close" onClick={onClose} aria-label="Đóng menu"><X/></button></div>
    <button className="menu-scroll menu-scroll-up" aria-label="Cuộn menu lên" onClick={() => navRef.current?.scrollBy({top:-240,behavior:"smooth"})}><ChevronUp/></button>
    <div className="sidebar-nav" ref={navRef}><button className={view === "home" ? "side-home active" : "side-home"} onClick={() => go("home")}><HomeIcon/><span>Trang chủ</span></button>{SIDEBAR_GROUPS.map(([title, ...items]) => { const collapsed = collapsedGroups.has(title); return <section className={collapsed ? "nav-group collapsed" : "nav-group"} key={title}><h3><button className="nav-group-toggle" type="button" aria-expanded={!collapsed} onClick={() => toggleGroup(title)}><span>{title}</span>{collapsed ? <ChevronDown/> : <ChevronUp/>}</button></h3><div className="nav-group-items" hidden={collapsed}>{items.map((item) => { const Icon = MENU_ICONS[iconIndex++ % MENU_ICONS.length]; const active = (item === "Tiền gửi và đầu tư" && view === "certificate-of-deposit") || (item === "Quản lý thông tin tín dụng" && view === "credit-information") || (item === "Quản lý chứng từ" && view === "documents-management") || (item === "Giải ngân" && ["disbursement", "create-disbursement", "review"].includes(view)) || (item === "Thư tín dụng (L/C nhập)" && isLc); return <button key={item} className={active ? "active" : ""} onClick={() => item === "Tiền gửi và đầu tư" ? go("certificate-of-deposit") : item === "Giải ngân" ? go("disbursement") : item === "Bảo lãnh" ? (onGuarantee(), onClose()) : item === "Thư tín dụng (L/C nhập)" ? go("letter-of-credit") : item === "Quản lý thông tin tín dụng" ? go("credit-information") : item === "Quản lý chứng từ" ? go("documents-management") : undefined}><Icon/>{item}</button>;})}</div></section>;})}</div>
    <button className="menu-scroll menu-scroll-down" aria-label="Cuộn menu xuống" onClick={() => navRef.current?.scrollBy({top:240,behavior:"smooth"})}><ChevronDown/></button>
  </aside></>;
}
function Topbar({ displayName, onMenu }: { displayName: string; onMenu: () => void }) { return <header className="topbar"><button className="hamburger" onClick={onMenu} aria-label="Mở menu"><Menu/></button><span className="back">←</span><span>ⓘ &nbsp; Trung tâm hỗ trợ</span><span className="demo-badge">Dữ liệu mô phỏng</span><div className="top-actions"><Search/><span>?</span><span className="bell">♧<b>9</b></span><span className="avatar">SBV</span><span><strong>{displayName}</strong><small>Người tạo</small></span><span>⌄</span></div></header>; }

function Home({ displayName, onGuarantee }: { displayName: string; onGuarantee: () => void }) {
  const rows = [["16:20, 01/02/2024", "Chuyển khoản đơn", "40,000,000", "Chờ duyệt"], ["16:20, 02/02/2024", "Chuyển khoản đơn", "30,000,000", "Đang xử lý"], ["16:20, 04/02/2024", "Chuyển khoản theo lô", "400,000,000", "Đang xử lý"], ["16:20, 11/02/2024", "Mở HĐTG", "500,000,000", "Chờ duyệt"]];
  const quickActions = [["Chuyển khoản đơn", Send], ["Tải lên mã QR", QrCode], ["Mở hợp đồng tiền gửi", Landmark], ["Chuyển khoản theo lô", Files], ["Bảo lãnh", ShieldCheck], ["Tùy chỉnh", SlidersHorizontal]] as const;
  return <div className="page dashboard-grid">
    <header className="home-welcome">
      <span>Xin chào,</span>
      <strong>{displayName}</strong>
    </header>
    <section className="card assets"><h2>Tổng quan tài sản <span>›</span></h2><div className="asset-body"><div className="donut" role="img" aria-label="Biểu đồ phân bổ tài sản"><span className="donut-hole"/></div><div className="asset-summary"><p>Tổng số dư VND</p><strong>******</strong><p><i className="asset-dot account"/>Tài khoản <b>******</b></p><p><i className="asset-dot deposit"/>Tiền gửi có kỳ hạn <b>******</b></p></div></div></section>
    <section className="card credit"><h2>Tổng quan tín dụng</h2><div className="coming"><span>▰</span><div><b>Sắp ra mắt</b><p>Tính năng đang được phát triển</p></div></div></section>
    <aside className="card offer"><h2>Dành riêng cho quý khách</h2><div className="offer-art">▤</div><span className="status blue">Chờ bổ sung</span><h3>Bổ sung hồ sơ để nâng cấp lên gói eKYC-Flex</h3><p>Nâng cấp gói dịch vụ để giao dịch trực tuyến nhanh chóng & bảo mật.</p><b className="orange">Bổ sung ngay</b></aside>
    <section className="card payment-reminder"><span>▱</span><div><h2>Quý khách có khoản cần thanh toán</h2><p>Vui lòng thanh toán trước 24 ngày để tránh quá hạn</p></div><button>Xem ngay</button></section>
    <section className="card quick-actions">{quickActions.map(([label, Icon]) => <button type="button" key={label} onClick={label === "Bảo lãnh" ? onGuarantee : undefined}><span><Icon aria-hidden="true"/></span><p>{label}</p></button>)}</section>
    <section className="card request-list"><h2>Danh sách yêu cầu</h2><div className="tabs"><b>Tất cả (16)</b><span>Chuyển khoản & thanh toán (14)</span><span>Tín dụng (2)</span></div><table><thead><tr><th>Thời gian</th><th>Loại giao dịch</th><th>Số tiền</th><th>Loại tiền</th><th>Trạng thái</th></tr></thead><tbody>{rows.map((r) => <tr key={r[0]}><td>{r[0]}</td><td>{r[1]}</td><td>{r[2]}</td><td>VND</td><td><span className="status amber">{r[3]}</span></td></tr>)}</tbody></table></section>
    <aside className="card rates"><h2>Tỷ giá ngoại tệ <span>›</span></h2>{[["🇺🇸", "USD"], ["🇪🇺", "EUR"], ["🇨🇳", "CNY"], ["🇯🇵", "JPY"]].map(([f, c]) => <p key={c}><b>{f} {c}</b><span>25,157</span><span>25,789</span></p>)}</aside>
  </div>;
}

function FeatureErrorPopup({ error, onClose }: { error: AppError; onClose: () => void }) {
  return <div className="error-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="error-modal" role="alertdialog" aria-modal="true" aria-labelledby="feature-error-title" aria-describedby="feature-error-message" data-agent-field="error-code" data-error-code={error.errorCode} data-error-id={error.errorId} data-operation={error.operation} data-error-kind="popup" data-error-priority="1000">
      <div className="error-modal-icon" aria-hidden="true">!</div>
      <h2 id="feature-error-title">{error.title}</h2>
      <p id="feature-error-message">{error.message}</p>
      <div className="error-modal-code">Mã lỗi: {error.errorCode}</div>
      <button type="button" autoFocus onClick={onClose}>Đóng</button>
    </section>
  </div>;
}

const REQUEST_ROWS = ["Bản nháp", "Chờ xác nhận tỷ giá", "Thành công", "Chờ duyệt", "Chưa xác định", "Chờ MSB tiếp nhận", "MSB đang xử lý", "Chờ chỉnh sửa", "MSB từ chối", "Đã hủy", "Hết hiệu lực"];
function DisbursementDashboard({ navigate }: { navigate: (view: View) => void }) {
  const purposes = [["Thanh toán nội địa", Building2], ["Thanh toán lương", UsersRound], ["Thanh toán T/T", ArrowLeftRight], ["Thanh toán LC/Nhờ thu", FileText], ["Thanh toán khác", MoreHorizontal]] as const;
  return <div className="page disbursement-page"><h1>Giải ngân</h1><section className="card limit-card"><h2>Hạn mức giải ngân</h2><div className="limit-values"><div><p>Hạn mức đã sử dụng</p><b>15,000,000,000 <small>VND</small></b></div><div><p>Hạn mức còn được sử dụng</p><b>35,000,000,000 <small>VND</small></b></div></div><div className="info">ⓘ Thông tin chỉ mang tính tham khảo. Hạn mức giải ngân thực tế có thể thay đổi tùy thời điểm.</div></section><section className="card purpose-card"><h2>Mục đích giải ngân</h2><p>Chọn mục đích giải ngân phù hợp với nhu cầu để tạo Đề nghị giải ngân mới</p><div className="purpose-list">{purposes.map(([label, Icon], index) => <button type="button" key={label} onClick={index === 0 ? () => navigate("create-disbursement") : undefined}><span><Icon aria-hidden="true"/></span>{label}</button>)}</div></section><section className="card applications"><h2>Danh sách yêu cầu đề nghị giải ngân</h2><div className="search">⌕ &nbsp; Tìm kiếm theo mã yêu cầu, số tiền giải ngân</div><table><thead><tr><th>Ngày tạo</th><th>Mã yêu cầu</th><th>Mục đích giải ngân</th><th>Mua bán ngoại tệ</th><th>Số tiền giải ngân</th><th>Trạng thái</th><th/></tr></thead><tbody>{Array.from({length: 16}, (_, i) => { const status = REQUEST_ROWS[Math.min(i, REQUEST_ROWS.length - 1)]; return <tr key={i}><td>15:07,<br/>02/09/2025</td><td>123456789</td><td>{i === 1 ? "Thanh toán lương" : "Thanh toán nội địa"}</td><td>Có</td><td>{(500_000_000 + i * 50_000_000).toLocaleString("en-US")} VND</td><td><span className={`status ${status.includes("từ chối") || status === "Đã hủy" ? "red" : status === "Thành công" ? "green" : "blue"}`}>{status}</span></td><td>⋮</td></tr>})}</tbody></table><div className="pagination">Hiển thị 1-16 của 300 bản ghi <span>‹ &nbsp; <b>1</b> &nbsp; 2 &nbsp; 3 &nbsp; 4 &nbsp; 5 &nbsp; ›</span></div></section></div>;
}

function FormField({ label, error, children, wide = false }: { label: string; error?: string; children: ReactNode; wide?: boolean }) { return <label className={wide ? "field wide" : "field"}><span>{label}</span>{children}{error && <small className="field-error">{error}</small>}</label>; }
function LegacyDisbursementForm({ sessionId, onSubmitResult, navigate }: { sessionId: string; onSubmitResult: (error: AppError | null) => void; navigate: (view: View) => void }) {
  const [form, setForm] = useState({ paymentPurpose: "", transferType: "Chuyển thường", bank: "MSB", accountNumber: "", accountName: "", amount: "", content: "" }); const [error, setError] = useState<AppError | null>(null); const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => { setForm((old) => ({...old, [key]: value})); if (error?.field === key) { setError(null); onSubmitResult(null); void requestJson(`/api/host/context/${sessionId}`, { method: "PUT", body: JSON.stringify({ screenId: "domestic-disbursement-create", routeId: "disbursement", screenState: "editing", lastOperation: "disbursement.domestic.edit" }) }); } }; const amount = Number(form.amount.replace(/\D/g, ""));
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.paymentPurpose || !form.accountNumber || !amount || !form.content) return; setBusy(true); setError(null); onSubmitResult(null); try { const result = await requestJson<{ outcome: "success" | "error"; beneficiaryName?: string; error?: AppError }>("/api/host/disbursement", { method: "POST", body: JSON.stringify({...form, amount, sessionId}) }); if (result.outcome === "error" && result.error) { setError(result.error); onSubmitResult(result.error); } else { setForm((old) => ({...old, accountName: result.beneficiaryName ?? old.accountName})); navigate("review"); } } catch { setError({ errorId: "local", errorCode: "SERVICE_UNAVAILABLE", scenarioId: "local", field: null, message: "Không thể xử lý yêu cầu lúc này." }); } finally { setBusy(false); } };
  return <div className="page form-page"><h1>Tạo yêu cầu Đề nghị giải ngân</h1><p>Mục đích: Thanh toán nội địa</p><div className="steps">{["Chỉ dẫn thanh toán", "Nguồn thanh toán", "Thông tin giải ngân", "Xác nhận & Hoàn tất"].map((x, i) => <div className={i === 0 ? "active" : ""} key={x}><b>{i + 1}</b><span>{x}</span></div>)}</div><form className="card disbursement-form" onSubmit={submit}><div className="form-heading"><div><h2>Chỉ dẫn thanh toán</h2><p>Nhập danh sách các bên thụ hưởng hoặc tải lên file lô</p></div><div><button type="button" className="link-button">⇩ Tải xuống file mẫu</button><button type="button" className="outline-button">⇧ Tải lên file lô</button></div></div>{error && <div className="business-error" role="alert" data-agent-field="error-code" data-error-code={error.errorCode} data-error-id={error.errorId}><b>{error.errorCode}</b><span>{error.message}</span><small>Kịch bản demo: {error.scenarioId}</small></div>}<div className="summary-fields"><FormField label="Loại tiền chuyển đi"><input value="VND" disabled/></FormField><FormField label="Bên trả phí"><input value="Bên chuyển" disabled/></FormField><FormField label="Tài khoản trả phí"><select disabled><option>Chọn tài khoản</option></select></FormField></div><div className="beneficiary"><div className="beneficiary-title"><div><h3>Bên thụ hưởng [1]</h3><p>Thông tin thụ hưởng</p><small>Vui lòng nhập đầy đủ các trường thông tin</small></div><button type="button">Thu gọn⌃</button></div><div className="fields-grid"><FormField label="Mục đích thanh toán"><select required value={form.paymentPurpose} onChange={(e) => set("paymentPurpose", e.target.value)}><option value="">Chọn mục đích thanh toán</option>{PURPOSES.map((x) => <option key={x}>{x}</option>)}</select></FormField><FormField label="Loại chuyển khoản"><select value={form.transferType} onChange={(e) => set("transferType", e.target.value)}><option>Chuyển thường</option><option>Chuyển 247</option></select></FormField><FormField label="Ngân hàng"><select value={form.bank} onChange={(e) => set("bank", e.target.value)}><option>MSB</option></select></FormField><FormField label="Chi nhánh"><select disabled><option>Hội sở chính</option></select></FormField><FormField label="Số tài khoản" error={error?.field === "accountNumber" ? error.message : undefined}><input required inputMode="numeric" value={form.accountNumber} onChange={(e) => set("accountNumber", e.target.value.replace(/\D/g, ""))} placeholder="Nhập số tài khoản hoặc chọn từ danh bạ"/></FormField><FormField label="Mã số thuế"><input placeholder="Nhập mã số thuế"/></FormField><FormField label="Tên tài khoản" wide><input value={form.accountName} onChange={(e) => set("accountName", e.target.value)} placeholder="Tên tài khoản sẽ được trả về theo kịch bản thành công"/></FormField><FormField label="Số tiền chuyển đi" error={error?.field === "amount" ? error.message : undefined}><div className="money-input"><input required inputMode="numeric" value={form.amount} onChange={(e) => set("amount", e.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ","))} placeholder="Nhập số tiền"/><b>VND</b></div></FormField><FormField label="Số tiền phí"><div className="money-input"><input value="Tự động hiển thị" disabled/><b>VND</b></div></FormField><FormField label="Nội dung chuyển tiền" wide error={error?.field === "content" ? error.message : undefined}><textarea required maxLength={210} value={form.content} onChange={(e) => set("content", e.target.value)} placeholder="Nhập nội dung chuyển tiền"/><small className="counter">{form.content.length}/210</small></FormField></div><label className="save-beneficiary"><input type="checkbox"/> Lưu bên thụ hưởng</label><div className="documents"><h3>Chứng từ chứng minh mục đích</h3><p>Quý khách cần cung cấp các loại chứng từ dưới đây để chứng minh mục đích thanh toán</p><div className="doc-tabs"><b>▤ Chứng từ</b><span>▤ Hóa đơn điện tử</span></div><div className="empty-doc"><span>⌕</span><b>Các loại chứng từ sẽ được hiển thị tại đây</b><p>Quý khách vui lòng chọn Mục đích thanh toán.</p></div></div></div><button type="button" className="add-beneficiary">⊕ Thêm bên thụ hưởng</button><section className="common-doc"><h3>Chứng từ chung</h3><p>Bao gồm các chứng từ chứng minh mục đích giải ngân có thể dùng chung cho tất cả các bên thụ hưởng.</p><select><option>Chọn loại chứng từ</option></select></section><section className="totals"><div><p>Số tiền chuyển đi</p><b>{amount.toLocaleString("vi-VN")} VND</b></div><div><p>Số tiền phí (Tạm tính)</p><b>0 VND</b></div></section><div className="form-actions"><button type="button" className="outline-button" onClick={() => navigate("disbursement")}>Quay lại</button><button className="primary-button" disabled={busy}>{busy ? "Đang kiểm tra…" : "Tiếp tục"}</button></div></form><span className="context-operation" data-agent-field="operation">disbursement.domestic.submit</span></div>;
}

function Review({ navigate }: { navigate: (view: View) => void }) { return <div className="page review-page"><section className="card"><div className="success-icon">✓</div><h1>Thông tin hợp lệ</h1><p>Yêu cầu đã vượt qua bước kiểm tra dữ liệu demo và sẵn sàng chuyển sang bước Nguồn thanh toán.</p><button className="primary-button" onClick={() => navigate("create-disbursement")}>Quay lại chỉnh sửa</button></section></div>; }
function DomesticTransfer() { return <div className="page form-page"><h1>Chuyển tiền trong nước</h1><section className="card"><h2>Tạo giao dịch chuyển tiền</h2><p>Nhập thông tin người thụ hưởng để bắt đầu giao dịch chuyển tiền nội địa.</p><div className="fields-grid"><FormField label="Số tài khoản"><input placeholder="Nhập số tài khoản"/></FormField><FormField label="Ngân hàng"><select><option>Chọn ngân hàng</option><option>MSB</option></select></FormField><FormField label="Số tiền"><input placeholder="Nhập số tiền" inputMode="numeric"/></FormField><FormField label="Nội dung chuyển tiền"><input placeholder="Nhập nội dung"/></FormField></div></section></div>; }
export default function App() {
  const [view, setView] = useState<View>("login"); const [sessionId, setSessionId] = useState(""); const [displayName, setDisplayName] = useState("Khách hàng"); const [currentError, setCurrentError] = useState<AppError | null>(null);
  const [featureError, setFeatureError] = useState<AppError | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string | null>(null);
  const [selectedTodoId, setSelectedTodoId] = useState<string | null>(null);
  const [context, setContext] = useState<ScreenContext | null>(null);
  const [lcDraft, setLcDraft] = useState<LcDraft | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const screen = useMemo(() => ({ "credit-information": ["credit-information", "home", "credit.information.view"], "documents-management": ["documents-management", "home", "documents.management.view"], "password-change": ["password-change", "home", "password.change.view"], "certificate-of-deposit": ["certificate-of-deposit", "home", "deposit.certificate.view"], home: ["home", "home", "dashboard.view"], disbursement: ["disbursement-dashboard", "disbursement", "disbursement.dashboard.view"], "create-disbursement": ["domestic-disbursement-create", "disbursement", "disbursement.domestic.edit"], review: ["domestic-disbursement-review", "disbursement", "disbursement.domestic.review"], "domestic-transfer": ["single-transfer-create", "transfer", "transfer.domestic.edit"], "letter-of-credit": ["letter-of-credit", "home", "letter-of-credit.dashboard.view"], "lc-issue": ["letter-of-credit-issue", "home", "letter-of-credit.issue.edit"], "lc-amend": ["letter-of-credit-amend", "home", "letter-of-credit.amend.edit"], "lc-success": ["letter-of-credit-success", "home", "letter-of-credit.issue.success"] } as const), []);
  const login = async (username: string) => { const result = await requestJson<{sessionId: string; displayName: string; context: ScreenContext}>("/api/demo/session", {method: "POST", body: JSON.stringify({username})}); setSessionId(result.sessionId); setDisplayName(result.displayName); setContext(result.context); setView("home"); };
  const navigate = async (next: View) => {
    setSelectedAccount(null); setSelectedTodoId(null); setCurrentError(null); setFeatureError(null); setView(next);
    if (sessionId && next !== "login") {
      const [screenId, routeId, lastOperation] = screen[next];
      const local: ScreenContext = { schemaVersion: "1.0", sessionId, screenId, routeId, lastOperation, screenState: next === "create-disbursement" ? "editing" : next === "review" ? "success" : "idle", lastErrorId: null, errorCode: null, locale: "vi-VN", capturedAt: new Date().toISOString(), source: "host-api" };
      setContext(local);
      try { await requestJson("/api/host/context/" + sessionId, {method: "PUT", body: JSON.stringify({screenId, routeId, lastOperation, screenState: local.screenState})}); } catch { /* Local navigation remains available offline. */ }
    }
  };
  const openGuarantee = async () => {
    if (view !== "home") await navigate("home");
    const config = await requestJson<GuaranteeErrorConfig>("/api/config/guarantee-error", { cache: "no-store" });
    if (!config.enabled || !config.error || !config.operation) return;
    const error: AppError = {
      errorId: `guarantee-${config.error.errorCode}-${Date.now()}`,
      errorCode: config.error.errorCode,
      scenarioId: `guarantee-${config.error.errorCode}`,
      field: null,
      title: config.error.title,
      message: config.error.message,
      operation: config.operation,
    };
    setCurrentError(error); setFeatureError(error);
  };
  const assistantNavigate = async (target: NavigationTarget) => {
    const next = (Object.keys(screen) as Array<keyof typeof screen>).find(key => screen[key][0] === target.screenId && screen[key][1] === target.routeId);
    if (!next) return false;
    let todo: { todolistID: string; todotype: string; loanAccount?: string } | undefined;
    if (target.todoId) {
      const data = await requestJson<{todoList: Array<{todolistID: string; todotype: string; loanAccount?: string}>}>(`/api/host/assistant-data/${encodeURIComponent(sessionId)}?details=true`);
      todo = data.todoList.find(item => item.todolistID === target.todoId);
      const screens: Record<string, string> = { "overdue-loan": "credit-information", "document-debt": "documents-management", "password-change": "password-change" };
      if (!todo || screens[todo.todotype] !== target.screenId) return false;
    }
    await navigate(next);
    setSelectedTodoId(todo?.todolistID ?? null);
    setSelectedAccount(todo?.loanAccount ?? null);
    return true;
  };
  const logout = () => {
    void fetch("/api/demo/session/" + sessionId, { method: "DELETE" }).catch(() => {});
    setCurrentError(null); setContext(null); setSessionId(""); setDisplayName("Khách hàng"); setView("login");
  };
  if (view === "login") return <Login onLogin={login}/>;
  return <div className="app-shell"><Sidebar view={view} navigate={navigate} open={mobileMenuOpen} onClose={() => setMobileMenuOpen(false)} onGuarantee={() => void openGuarantee()}/><div className="workspace"><Topbar displayName={displayName} onMenu={() => setMobileMenuOpen(true)}/><button className="logout-demo" onClick={logout}>Đăng xuất</button>{view === "credit-information" && <CreditInformation sessionId={sessionId} selectedAccount={selectedAccount} onClose={() => setSelectedAccount(null)}/>} {view === "documents-management" && <TodoDestination sessionId={sessionId} todoId={selectedTodoId} kind="document-debt"/>} {view === "password-change" && <TodoDestination sessionId={sessionId} todoId={selectedTodoId} kind="password-change"/>} {view === "certificate-of-deposit" && <CertificateOfDeposit/>} {view === "home" && <Home displayName={displayName} onGuarantee={() => void openGuarantee()}/>} {view === "disbursement" && <DisbursementDashboard navigate={navigate}/>} {view === "create-disbursement" && <DisbursementForm sessionId={sessionId} onSubmitResult={setCurrentError} navigate={navigate}/>} {view === "review" && <Review navigate={navigate}/>} {view === "domestic-transfer" && <DomesticTransfer/>} {view === "letter-of-credit" && <LetterOfCreditDashboard navigate={navigate}/>} {view === "lc-issue" && <LetterOfCreditForm mode="issue" navigate={navigate} initialData={lcDraft}/>} {view === "lc-amend" && <LetterOfCreditForm mode="amend" navigate={navigate}/>} {view === "lc-success" && <LetterOfCreditSuccess navigate={navigate}/>}</div>{featureError && <FeatureErrorPopup error={featureError} onClose={() => setFeatureError(null)}/>} {context && <AssistantLauncher key={sessionId} sessionId={sessionId} context={context} currentError={currentError} onNavigate={assistantNavigate} onLcAutofill={(fields, missingFields) => { setLcDraft({ fields, missingFields }); void navigate("lc-issue"); }}/>}</div>;
}
