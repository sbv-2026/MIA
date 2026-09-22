import { useState, type FormEvent, type ReactNode } from "react";
import "./DisbursementForm.css";

type FieldName = "accountNumber" | "amount" | "content";
type InlineRule = {
  id: string;
  field: FieldName;
  value: string;
  matcher: "equals" | "contains" | "containsAny" | "minInclusive" | "maxExclusive";
  errorCode: string;
  message: string;
  priority: number;
};
type PopupRule = {
  id: string;
  errorCode: string;
  title: string;
  message: string;
  priority: number;
  match: Record<string, string>;
};
type ErrorConfig = {
  version: string;
  operation: string;
  inlineErrors: Record<FieldName, InlineRule[]>;
  popupErrors: { continue: PopupRule[] };
};
type AppError = {
  errorId: string;
  errorCode: string;
  scenarioId: string;
  field: string | null;
  title?: string | null;
  message: string;
};

const PURPOSES = ["Hàng hóa, dịch vụ có hóa đơn", "Thanh toán nghĩa vụ với nhà nước", "Mua bất động sản", "Khác"];

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.json() as Promise<T>;
}

function normalizedValue(field: FieldName, value: string): string {
  return field === "amount" ? value.replace(/\D/g, "") : value.trim();
}

function matchesInline(rule: InlineRule, rawValue: string): boolean {
  const actual = normalizedValue(rule.field, rawValue);
  const expected = String(rule.value);
  if (rule.matcher === "equals") return actual === expected;
  if (rule.matcher === "contains") return actual.toLocaleLowerCase("vi").includes(expected.toLocaleLowerCase("vi"));
  if (rule.matcher === "containsAny") return [...expected].some((character) => actual.includes(character));
  const amount = Number(actual || 0);
  if (rule.matcher === "minInclusive") return amount >= Number(expected);
  return amount < Number(expected);
}

function matchesPopup(rule: PopupRule, form: { accountNumber: string; amount: string; content: string }): boolean {
  const match = rule.match;
  const amount = Number(form.amount.replace(/\D/g, "") || 0);
  if ("accountNumber" in match && match.accountNumber !== form.accountNumber.trim()) return false;
  if ("content" in match && match.content !== form.content.trim()) return false;
  if ("contentContains" in match && !form.content.toLocaleLowerCase("vi").includes(match.contentContains.toLocaleLowerCase("vi"))) return false;
  if ("contentContainsAny" in match && ![...match.contentContainsAny].some((character) => form.content.includes(character))) return false;
  if ("amountEquals" in match && amount !== Number(match.amountEquals)) return false;
  if ("minAmountInclusive" in match && amount < Number(match.minAmountInclusive)) return false;
  if ("maxAmountExclusive" in match && amount >= Number(match.maxAmountExclusive)) return false;
  return true;
}

function highestPriority<T extends { priority: number }>(rules: T[]): T | undefined {
  return rules.reduce<T | undefined>((highest, rule) =>
    !highest || rule.priority > highest.priority ? rule : highest, undefined);
}

function InlineField({ label, error, children, wide = false }: {
  label: string;
  error?: InlineRule;
  children: ReactNode;
  wide?: boolean;
}) {
  return <label className={`${wide ? "field wide" : "field"}${error ? " field-invalid" : ""}`}>
    <span>{label}</span>
    {children}
    {error && <small className="field-error" role="alert" data-agent-field="error-code"
      data-error-id={`inline-${error.id}`} data-error-code={error.errorCode}
      data-operation="disbursement.domestic.submit" data-error-field={error.field}
      data-error-kind="inline" data-error-priority={error.priority}>
      <b>{error.errorCode}</b> — {error.message}
    </small>}
  </label>;
}

function ErrorPopup({ error, onClose }: { error: AppError; onClose: () => void }) {
  return <div className="error-modal-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <section className="error-modal" role="alertdialog" aria-modal="true" aria-labelledby="error-modal-title" aria-describedby="error-modal-message" data-agent-field="error-code" data-error-code={error.errorCode} data-error-id={error.errorId} data-operation="disbursement.domestic.submit" data-error-kind="popup" data-error-priority="1000">
      <div className="error-modal-icon" aria-hidden="true">!</div>
      <h2 id="error-modal-title">{error.title ?? "Không thể tiếp tục giao dịch"}</h2>
      <p id="error-modal-message">{error.message}</p>
      <div className="error-modal-code">{error.errorCode}</div>
      <button type="button" autoFocus onClick={onClose}>Đóng</button>
    </section>
  </div>;
}

export function DisbursementForm({ sessionId, onSubmitResult, navigate }: {
  sessionId: string;
  onSubmitResult: (error: AppError | null) => void;
  navigate: (view: "disbursement" | "review") => void;
}) {
  const [form, setForm] = useState({
    paymentPurpose: "", transferType: "Chuyển thường", bank: "MSB", accountNumber: "", accountName: "", amount: "", content: "",
  });
  const [inlineErrors, setInlineErrors] = useState<Partial<Record<FieldName, InlineRule>>>({});
  const [popupError, setPopupError] = useState<AppError | null>(null);
  const [hasActiveBusinessError, setHasActiveBusinessError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [beneficiaryLookupBusy, setBeneficiaryLookupBusy] = useState(false);
  const amount = Number(form.amount.replace(/\D/g, ""));

  const publishInlineErrors = (next: Partial<Record<FieldName, InlineRule>>) => {
    const active = highestPriority(Object.values(next).filter((rule): rule is InlineRule => Boolean(rule)));
    const presentedError: AppError | null = active ? {
      errorId: `inline-${active.id}`,
      errorCode: active.errorCode,
      scenarioId: active.id,
      field: active.field,
      message: active.message,
    } : null;
    setHasActiveBusinessError(Boolean(presentedError)); onSubmitResult(presentedError);
  };

  const set = (key: keyof typeof form, value: string) => {
    setForm((old) => ({ ...old, [key]: value }));
    if (key === "accountNumber" || key === "amount" || key === "content") {
      const next = { ...inlineErrors, [key]: undefined }; setInlineErrors(next); publishInlineErrors(next);
      if (hasActiveBusinessError) {
        void requestJson(`/api/host/context/${sessionId}`, {
          method: "PUT",
          body: JSON.stringify({ screenId: "domestic-disbursement-create", routeId: "disbursement", screenState: "editing", lastOperation: "disbursement.domestic.edit" }),
        });
      }
    }
  };

  const validateOnBlur = async (field: FieldName, currentValue: string) => {
    try {
      // Fetching here is intentional: edits to YAML take effect on the next blur.
      const config = await requestJson<ErrorConfig>("/api/config/disbursement-errors", { cache: "no-store" });
      const matched = highestPriority((config.inlineErrors[field] ?? [])
        .filter((rule) => matchesInline(rule, currentValue)));
      let resolved = matched;
      if (field === "accountNumber" && currentValue.trim() && !matched) {
        setBeneficiaryLookupBusy(true);
        const response = await fetch(`/api/host/beneficiaries/${encodeURIComponent(currentValue.trim())}`, { cache: "no-store" });
        if (response.ok) {
          const beneficiary = await response.json() as { beneficiaryName: string };
          setForm((old) => ({ ...old, accountName: beneficiary.beneficiaryName }));
        } else if (response.status === 404) {
          setForm((old) => ({ ...old, accountName: "" }));
          resolved = { id: "account-not-found", field: "accountNumber", value: currentValue, matcher: "equals", errorCode: "11001", message: "Không tìm thấy tài khoản thụ hưởng tại MSB.", priority: 90 };
        }
      }
      const next = { ...inlineErrors, [field]: resolved }; setInlineErrors(next); publishInlineErrors(next);
    } catch {
      const next = { ...inlineErrors, [field]: undefined }; setInlineErrors(next); publishInlineErrors(next);
    } finally {
      if (field === "accountNumber") setBeneficiaryLookupBusy(false);
    }
  };

  const closePopup = () => {
    setPopupError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setPopupError(null);
    setHasActiveBusinessError(false);
    onSubmitResult(null);
    try {
      const config = await requestJson<ErrorConfig>("/api/config/disbursement-errors", { cache: "no-store" });
      // Popup rules always run first, including when another required field is empty.
      const matchedPopup = highestPriority((config.popupErrors.continue ?? [])
        .filter((rule) => matchesPopup(rule, form)));
      if (matchedPopup && (!form.paymentPurpose || !form.accountNumber || !amount || !form.content)) {
        // Preserve immediate configured validation for incomplete forms. Complete
        // requests go through Host so the Agent can read the persisted error.
        const configuredError = { errorId: `local-${matchedPopup.id}`, errorCode: matchedPopup.errorCode, scenarioId: matchedPopup.id, field: null, title: matchedPopup.title, message: matchedPopup.message };
        setPopupError(configuredError);
        setHasActiveBusinessError(true);
        onSubmitResult(configuredError);
        return;
      }
      if (!form.paymentPurpose || !form.accountNumber || !amount || !form.content) return;
      const result = await requestJson<{ outcome: "success" | "error"; beneficiaryName?: string; error?: AppError }>("/api/host/disbursement", {
        method: "POST", body: JSON.stringify({ ...form, amount, sessionId }),
      });
      if (result.outcome === "error" && result.error) {
        setPopupError(result.error);
        setHasActiveBusinessError(true);
        onSubmitResult(result.error);
      } else {
        setForm((old) => ({ ...old, accountName: result.beneficiaryName ?? old.accountName }));
        navigate("review");
      }
    } catch {
      const localError = { errorId: "local-service", errorCode: "90000", scenarioId: "local-service", field: null, title: "Không thể xử lý yêu cầu", message: "Hệ thống đang gián đoạn. Quý khách vui lòng thử lại sau." };
      setPopupError(localError);
      setHasActiveBusinessError(true);
      onSubmitResult(localError);
    } finally {
      setBusy(false);
    }
  };

  return <div className="page form-page">
    <h1>Tạo yêu cầu Đề nghị giải ngân</h1>
    <p>Mục đích: Thanh toán nội địa</p>
    <div className="steps">{["Chỉ dẫn thanh toán", "Nguồn thanh toán", "Thông tin giải ngân", "Xác nhận & Hoàn tất"].map((item, index) => <div className={index === 0 ? "active" : ""} key={item}><b>{index + 1}</b><span>{item}</span></div>)}</div>
    <form className="card disbursement-form" onSubmit={submit} noValidate>
      <div className="form-heading"><div><h2>Chỉ dẫn thanh toán</h2><p>Nhập danh sách các bên thụ hưởng hoặc tải lên file lô</p></div><div><button type="button" className="link-button">⇩ Tải xuống file mẫu</button><button type="button" className="outline-button">⇧ Tải lên file lô</button></div></div>
      <div className="summary-fields"><InlineField label="Loại tiền chuyển đi"><input value="VND" disabled /></InlineField><InlineField label="Bên trả phí"><input value="Bên chuyển" disabled /></InlineField><InlineField label="Tài khoản trả phí"><select disabled><option>Chọn tài khoản</option></select></InlineField></div>
      <div className="beneficiary">
        <div className="beneficiary-title"><div><h3>Bên thụ hưởng [1]</h3><p>Thông tin thụ hưởng</p><small>Vui lòng nhập đầy đủ các trường thông tin</small></div><button type="button">Thu gọn⌃</button></div>
        <div className="fields-grid">
          <InlineField label="Mục đích thanh toán"><select value={form.paymentPurpose} onChange={(event) => set("paymentPurpose", event.target.value)}><option value="">Chọn mục đích thanh toán</option>{PURPOSES.map((purpose) => <option key={purpose}>{purpose}</option>)}</select></InlineField>
          <InlineField label="Loại chuyển khoản"><select value={form.transferType} onChange={(event) => set("transferType", event.target.value)}><option>Chuyển thường</option><option>Chuyển 247</option></select></InlineField>
          <InlineField label="Ngân hàng"><select value={form.bank} onChange={(event) => set("bank", event.target.value)}><option>MSB</option></select></InlineField>
          <InlineField label="Chi nhánh"><select disabled><option>Hội sở chính</option></select></InlineField>
          <InlineField label="Số tài khoản" error={inlineErrors.accountNumber}><input inputMode="numeric" value={form.accountNumber} onChange={(event) => set("accountNumber", event.target.value.replace(/\D/g, ""))} onBlur={(event) => void validateOnBlur("accountNumber", event.currentTarget.value)} aria-invalid={Boolean(inlineErrors.accountNumber)} placeholder="Nhập số tài khoản hoặc chọn từ danh bạ" /></InlineField>
          <InlineField label="Mã số thuế"><input placeholder="Nhập mã số thuế" /></InlineField>
          <InlineField label="Tên người thụ hưởng" wide><input value={form.accountName} readOnly aria-busy={beneficiaryLookupBusy} placeholder={beneficiaryLookupBusy ? "Đang tra cứu…" : "Tên người thụ hưởng được tra cứu tự động"} /></InlineField>
          <InlineField label="Số tiền chuyển đi" error={inlineErrors.amount}><div className="money-input"><input inputMode="numeric" value={form.amount} onChange={(event) => set("amount", event.target.value.replace(/\D/g, "").replace(/\B(?=(\d{3})+(?!\d))/g, ","))} onBlur={(event) => void validateOnBlur("amount", event.currentTarget.value)} aria-invalid={Boolean(inlineErrors.amount)} placeholder="Nhập số tiền" /><b>VND</b></div></InlineField>
          <InlineField label="Số tiền phí"><div className="money-input"><input value="Tự động hiển thị" disabled /><b>VND</b></div></InlineField>
          <InlineField label="Nội dung chuyển tiền" wide error={inlineErrors.content}><textarea maxLength={210} value={form.content} onChange={(event) => set("content", event.target.value)} onBlur={(event) => void validateOnBlur("content", event.currentTarget.value)} aria-invalid={Boolean(inlineErrors.content)} placeholder="Nhập nội dung chuyển tiền" /><small className="counter">{form.content.length}/210</small></InlineField>
        </div>
        <label className="save-beneficiary"><input type="checkbox" /> Lưu bên thụ hưởng</label>
        <div className="documents"><h3>Chứng từ chứng minh mục đích</h3><p>Quý khách cần cung cấp các loại chứng từ dưới đây để chứng minh mục đích thanh toán</p><div className="doc-tabs"><b>▤ Chứng từ</b><span>▤ Hóa đơn điện tử</span></div><div className="empty-doc"><span>⌕</span><b>Các loại chứng từ sẽ được hiển thị tại đây</b><p>Quý khách vui lòng chọn Mục đích thanh toán.</p></div></div>
      </div>
      <button type="button" className="add-beneficiary">⊕ Thêm bên thụ hưởng</button>
      <section className="common-doc"><h3>Chứng từ chung</h3><p>Bao gồm các chứng từ chứng minh mục đích giải ngân có thể dùng chung cho tất cả các bên thụ hưởng.</p><select><option>Chọn loại chứng từ</option></select></section>
      <section className="totals"><div><p>Số tiền chuyển đi</p><b>{amount.toLocaleString("vi-VN")} VND</b></div><div><p>Số tiền phí (Tạm tính)</p><b>0 VND</b></div></section>
      <div className="form-actions"><button type="button" className="outline-button" onClick={() => navigate("disbursement")}>Quay lại</button><button type="submit" className="primary-button" data-popup-trigger="continue" disabled={busy}>{busy ? "Đang kiểm tra…" : "Tiếp tục"}</button></div>
    </form>
    <span className="context-operation" data-agent-field="operation">disbursement.domestic.submit</span>
    {popupError && <ErrorPopup error={popupError} onClose={closePopup} />}
  </div>;
}
