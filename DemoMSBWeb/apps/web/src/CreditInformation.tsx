import { useEffect, useRef, useState } from "react";

export type Loan = { todoId: string; accountNumber: string; disbursedAmount: number; outstanding: number; currency: string; disbursementDate: string; maturityDate: string; termMonths: number; interestRate: number; status: string; overduePrincipal: number; overdueInterest: number; penalty: number; nextPrincipal: number; nextInterest: number; repaymentDate: string; collectionAccount: string; product: string; history: Array<{date: string; description: string; amount: number}>; schedule: Array<{date: string; principal: number; interest: number}> };
const money = (value: number) => value.toLocaleString("vi-VN");
const date = (value: string) => value.split("-").reverse().join("/");

export function CreditInformation({ sessionId, selectedAccount, onClose }: { sessionId: string; selectedAccount: string | null; onClose: () => void }) {
  const [loans, setLoans] = useState<Loan[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [account, setAccount] = useState<string | null>(selectedAccount);
  const [category, setCategory] = useState("loans");
  useEffect(() => { setAccount(selectedAccount); setQuery(""); }, [selectedAccount]);
  useEffect(() => {
    const controller = new AbortController();
    setError(false); setLoans(null);
    void fetch(`/api/host/credit-information/${encodeURIComponent(sessionId)}`, { signal: controller.signal, cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(); return response.json() as Promise<{loans: Loan[]}>; })
      .then(data => setLoans(data.loans)).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [sessionId, attempt]);
  const selected = loans?.find(loan => loan.accountNumber === account);
  const total = loans?.reduce((sum, loan) => sum + loan.outstanding, 0) ?? 0;
  const overdue = loans?.reduce((sum, loan) => sum + loan.overduePrincipal + loan.overdueInterest + loan.penalty, 0) ?? 0;
  const principal = loans?.reduce((sum, loan) => sum + loan.overduePrincipal, 0) ?? 0;
  const interest = loans?.reduce((sum, loan) => sum + loan.overdueInterest, 0) ?? 0;
  const rows = loans?.filter(loan => loan.accountNumber.includes(query.trim()) && (!overdueOnly || loan.status === "overdue")) ?? [];
  const close = () => { setAccount(null); onClose(); };
  const download = () => {
    const csv = "\uFEFFSố tài khoản vay,Số tiền giải ngân,Dư nợ,Loại tiền,Ngày đáo hạn,Trạng thái\n" + rows.map(loan => `${loan.accountNumber},${loan.disbursedAmount},${loan.outstanding},${loan.currency},${loan.maturityDate},Quá hạn`).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "tai-khoan-vay.csv"; link.click(); URL.revokeObjectURL(url);
  };
  return <div className="page credit-page"><h1>‹ Quản lý nghĩa vụ tín dụng</h1><nav className="credit-category-tabs" aria-label="Loại nghĩa vụ tín dụng">{[["loans", "♧ Khoản vay"], ["guarantees", "♢ Khoản bảo lãnh"], ["letters", "✉ Khoản thư tín dụng"]].map(([id,label]) => <button key={id} className={category === id ? "active" : ""} onClick={() => setCategory(id)}>{label}</button>)}</nav>
    {category !== "loans" ? <section className="card"><h2>{category === "guarantees" ? "Khoản bảo lãnh" : "Khoản thư tín dụng"}</h2><p>Chưa có nghĩa vụ trong dữ liệu demo của khách hàng này.</p></section> : <>
    {error ? <div role="alert">Không thể tải thông tin tín dụng. <button onClick={() => setAttempt(value => value + 1)}>Thử lại</button></div> : !loans ? <p role="status">Đang tải thông tin khoản vay…</p> : <>
    <section className="card credit-overview"><h2>Tổng quan nghĩa vụ khoản vay</h2><div className="credit-overview-grid"><div className="credit-chart"><h3>Kế hoạch trả nợ gốc & lãi dự kiến ⓘ</h3><div className="credit-chart-bars" role="img" aria-label={`Gốc đến hạn ${money(principal)} VND, lãi đến hạn ${money(interest)} VND`}><div className="credit-chart-bar"><span style={{ height: "12px" }} className="interest"/><span style={{ height: principal ? "130px" : "2px" }} className="principal">{money(principal / 1_000_000)}</span><small>09/2026</small></div></div><p><span className="chart-key principal"/> Gốc <span className="chart-key interest"/> Lãi <small>Đơn vị: Triệu đồng</small></p></div><div className="credit-summary"><div className="credit-total"><h3>Tổng dư nợ</h3><strong>{money(total)} <small>VND</small></strong><p>Ngắn hạn <b>{money(total)} VND</b></p><p>Trung hạn <b>0 VND</b></p><p>Dài hạn <b>0 VND</b></p></div><div className="credit-obligations"><div><h3>Nghĩa vụ sắp đến hạn ⓘ</h3><strong>0 VND</strong><p>Gốc đến hạn <b>0 VND</b></p><p>Lãi đến hạn <b>0 VND</b></p></div><button className="credit-overdue" onClick={() => setOverdueOnly(true)}><h3>Nghĩa vụ quá hạn ⓘ <span>→</span></h3><strong>{money(overdue)} VND</strong><p>Gốc quá hạn <b>{money(principal)} VND</b></p><p>Lãi quá hạn <b>{money(interest)} VND</b></p><p>Phí phạt quá hạn <b>0 VND</b></p></button></div></div></div><p className="credit-note">ⓘ Dữ liệu mô phỏng theo tài khoản vay được khai báo trong danh sách việc cần làm.</p></section>
    <section className="card credit-loan-list"><h2>Danh sách tài khoản vay</h2><div className="credit-list-tools"><input aria-label="Tìm theo số tài khoản vay" placeholder="⌕ Tìm kiếm theo số tài khoản vay" value={query} onChange={event => setQuery(event.target.value)}/><button className={overdueOnly ? "active" : ""} onClick={() => setOverdueOnly(value => !value)} aria-pressed={overdueOnly}>☷ {overdueOnly ? "Quá hạn" : "Lọc quá hạn"}</button><button className="outline-button" onClick={download}>↓ Tải về</button></div><div className="credit-table-scroll"><table><thead><tr><th>STT</th><th>Ngày giải ngân</th><th>Số tài khoản vay</th><th>Số tiền giải ngân</th><th>Dư nợ hiện tại</th><th>Loại tiền</th><th>Ngày đáo hạn</th><th>Trạng thái</th><th/></tr></thead><tbody>{rows.map((loan,index) => <tr key={loan.accountNumber} className={account === loan.accountNumber ? "credit-selected-row" : ""}><td>{index+1}</td><td>{date(loan.disbursementDate)}</td><td><button className="loan-account-link" onClick={() => setAccount(loan.accountNumber)}>{loan.accountNumber}</button></td><td>{money(loan.disbursedAmount)}</td><td>{money(loan.outstanding)}</td><td>{loan.currency}</td><td>{date(loan.maturityDate)}</td><td><span className="status red">Quá hạn</span></td><td><button className="loan-detail-trigger" aria-label={`Xem chi tiết tài khoản vay ${loan.accountNumber}`} onClick={() => setAccount(loan.accountNumber)}>⋮</button></td></tr>)}</tbody></table></div>{rows.length === 0 && <p>Không tìm thấy tài khoản vay.</p>}<footer className="credit-list-footer">Hiển thị {rows.length} / {loans.length} tài khoản vay</footer></section>
    {account && !selected && <p role="alert">Không tìm thấy tài khoản vay {account} trong phiên khách hàng này.</p>}
    </>}
    </>}
    {selected && <LoanDrawer loan={selected} close={close}/>}
  </div>;
}

function LoanDrawer({ loan, close }: { loan: Loan; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState("information");
  useEffect(() => { const dialog = ref.current; dialog?.showModal(); return () => dialog?.close(); }, []);
  useEffect(() => setTab("information"), [loan.accountNumber]);
  const field = (label: string, value: string) => <div key={label}><span>{label}</span><b>{value}</b></div>;
  return <dialog ref={ref} className="loan-drawer" onCancel={close} aria-labelledby="loan-drawer-title"><header><h2 id="loan-drawer-title">Chi tiết tài khoản vay {loan.accountNumber}</h2><button aria-label="Đóng chi tiết khoản vay" onClick={close}>×</button></header><nav className="loan-drawer-tabs" aria-label="Chi tiết khoản vay">{[["information","Thông tin khoản vay"],["history","Lịch sử giao dịch"],["schedule","Lịch trả nợ dự kiến"]].map(([id,label]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === "information" ? <><section className="loan-general"><h3>Thông tin chung</h3><div className="loan-field-grid">{field("Số tiền giải ngân", `${money(loan.disbursedAmount)} VND`)}{field("Dư nợ hiện tại", `${money(loan.outstanding)} VND`)}{field("Gói giải pháp", "Hạn mức tín dụng doanh nghiệp")}{field("Ngày giải ngân", date(loan.disbursementDate))}{field("Kỳ hạn", `${loan.termMonths} tháng`)}{field("Ngày đáo hạn", date(loan.maturityDate))}{field("Số tài khoản vay", loan.accountNumber)}{field("Lãi suất", `${loan.interestRate}%/năm`)}<div><span>Trạng thái</span><b className="status red">Quá hạn</b></div></div></section><section><h3>Kỳ trả nợ tiếp theo</h3><div className="loan-field-grid">{field("Gốc đến hạn", `${money(loan.nextPrincipal)} VND`)}{field("Tài khoản thu nợ tự động (gốc)", loan.collectionAccount)}{field("Ngày trả nợ", date(loan.repaymentDate))}{field("Lãi đến hạn", `${money(loan.nextInterest)} VND`)}{field("Tài khoản thu nợ tự động (lãi)", loan.collectionAccount)}</div></section><section><h3>Nghĩa vụ quá hạn</h3><div className="loan-field-grid">{field("Gốc quá hạn", `${money(loan.overduePrincipal)} VND`)}{field("Lãi quá hạn", `${money(loan.overdueInterest)} VND`)}{field("Phí phạt quá hạn", `${money(loan.penalty)} VND`)}</div></section></> : tab === "history" ? <section><h3>Lịch sử giao dịch</h3>{loan.history.map((item,index) => <div className="loan-history-row" key={index}><span>{date(item.date)}</span><b>Giải ngân</b><span>{money(item.amount)} VND</span></div>)}</section> : <section><h3>Lịch trả nợ dự kiến</h3>{loan.schedule.map((item,index) => <div className="loan-history-row" key={index}><span>{date(item.date)}</span><b>Gốc: {money(item.principal)} VND</b><span>Lãi: {money(item.interest)} VND</span></div>)}</section>}
  </dialog>;
}
