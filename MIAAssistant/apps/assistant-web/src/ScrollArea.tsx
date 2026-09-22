import { useEffect, useRef, useState, type ReactNode } from "react";

export function ScrollArea({ children, resetKey }: { children: ReactNode; resetKey?: unknown }) {
  const viewport = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ up: false, down: false });
  const measure = () => {
    const element = viewport.current;
    if (element) setEdges({ up: element.scrollTop > 2, down: element.scrollTop + element.clientHeight < element.scrollHeight - 2 });
  };
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
    const observer = new ResizeObserver(measure);
    if (viewport.current) observer.observe(viewport.current);
    if (inner.current) observer.observe(inner.current);
    measure();
    return () => observer.disconnect();
  }, [resetKey]);
  const move = (direction: number) => {
    const element = viewport.current;
    element?.scrollBy({ top: direction * element.clientHeight * .7, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
  };
  return <div className="mia-scroll-area">
    {edges.up && <button type="button" className="mia-scroll-hint mia-scroll-up" aria-label="Kéo lên để xem nội dung phía trên" onClick={() => move(-1)}>⌃ <small>Kéo lên</small></button>}
    <div className="mia-scroll-viewport" ref={viewport} onScroll={measure} tabIndex={0} aria-label="Nội dung MIA"><div className="mia-scroll-inner" ref={inner}>{children}</div></div>
    {edges.down && <button type="button" className="mia-scroll-hint mia-scroll-down" aria-label="Kéo xuống để xem thêm nội dung" onClick={() => move(1)}>⌄ <small>Kéo xuống</small></button>}
  </div>;
}
