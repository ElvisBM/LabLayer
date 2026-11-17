import { ImagePreview } from '../requests/PublicQuoteImage';
import { useEffect, useRef, useState } from 'react';
export type Attachment = { id: string; name: string; mime: string };
export function Files({
  files,
  load,
  grid = false,
}: {
  files: Attachment[];
  grid?: boolean;
  load: (id: string, preview?: boolean) => Promise<Blob>;
}) {
  return (
    <div className={grid ? "assistant-file-grid" : "space-y-3"}>
      {files.map((file) => (
        <FilePreview key={file.id} file={file} load={load} />
      ))}
    </div>
  );
}
function FilePreview({
  file,
  load,
}: {
  file: Attachment;
  load: (id: string, preview?: boolean) => Promise<Blob>;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  const container = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '200px' });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!visible || file.mime.startsWith("image/")) return;
    let active = true,
      objectUrl = "";
    loadRef
      .current(file.id)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      })
      .catch(() => {
        if (active) setError("Não foi possível abrir o anexo.");
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [file.id, visible]);
  return (
    <div ref={container} className="assistant-file rounded-xl border p-3 space-y-2">
      {error && <p role="alert">{error}</p>}
      {visible && file.mime.startsWith('image/') ? <ImagePreview imageKey={file.id} name={file.name}
        loadPreview={() => loadRef.current(file.id, true)} loadOriginal={() => loadRef.current(file.id)} /> : url ? (
        <audio className="w-full" src={url} controls preload="metadata" />
      ) : (
        !error && <p>{visible ? "Carregando anexo…" : "Prévia do arquivo"}</p>
      )}
      <p className="text-sm break-all">{file.name}</p>
    </div>
  );
}
