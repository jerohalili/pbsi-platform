import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  FileText,
  Image as ImageIcon,
  Link2,
  Loader2,
  Pencil,
  Trash2,
  Type,
  Upload,
  Video,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button.tsx';
import { Input } from '@/components/ui/input.tsx';
import { Label } from '@/components/ui/label.tsx';
import { useToast } from '@/components/ui/toast.tsx';
import { RichTextEditor } from '@/components/courses/RichTextEditor.tsx';
import type { ModuleContent } from '@/components/courses/ModuleContentViewer.tsx';
import api from '@/lib/api.ts';
import { getErrorMessage } from '@/lib/errors.ts';
import { cn } from '@/lib/utils.ts';
import { deleteUploadedFile, uploadFile } from '@/lib/upload.ts';
import type { UploadKind, UploadResult } from '@/lib/upload.ts';
import { htmlToText, toEditorHtml } from '@/lib/sanitize.ts';

type ContentType = ModuleContent['type'];

const TYPES: ContentType[] = ['text', 'video', 'image', 'file', 'link'];

const TYPE_META: Record<ContentType, { label: string; icon: LucideIcon }> = {
  text: { label: 'Text', icon: Type },
  video: { label: 'Video', icon: Video },
  image: { label: 'Image', icon: ImageIcon },
  file: { label: 'File / PDF', icon: FileText },
  link: { label: 'Web link', icon: Link2 },
};

const iconButton =
  'inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ' +
  'disabled:pointer-events-none disabled:opacity-40';

function isWebUrl(value: string | null | undefined): value is string {
  return !!value && /^https?:\/\//i.test(value);
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text;
}

function summaryOf(block: ModuleContent): string {
  if (block.type === 'text') {
    return truncate(htmlToText(block.content ?? ''), 140) || 'No content yet';
  }
  return block.url ?? 'No link yet';
}

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// ---------------------------------------------------------------------------
// Add / edit form for one block. Owns its own state, so editing never leaks
// into the "add" form (or into another block).
// ---------------------------------------------------------------------------

interface BlockEditorProps {
  moduleId: string;
  type: ContentType;
  /** Present when editing an existing block. */
  block?: ModuleContent;
  nextOrderIndex: number;
  onCancel: () => void;
  onSaved: (message: string) => void;
}

function BlockEditor({ moduleId, type, block, nextOrderIndex, onCancel, onSaved }: BlockEditorProps) {
  const uid = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isEdit = !!block;
  const isMedia = type === 'video' || type === 'image' || type === 'file';

  const [title, setTitle] = useState(block?.title ?? '');
  const [content, setContent] = useState(block?.content ?? '');
  const [url, setUrl] = useState(block?.url ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const pickFile = (picked: File | null | undefined) => {
    if (picked) setFile(picked);
  };

  const save = async () => {
    setError('');
    const cleanTitle = title.trim();
    const cleanUrl = url.trim();

    if (!cleanTitle) return setError('Give this block a title.');
    if (type === 'text' && !htmlToText(content)) return setError('Write some content first.');
    if (type === 'link' && !isWebUrl(cleanUrl)) {
      return setError('Enter a valid link starting with http:// or https://');
    }
    if (isMedia && !file && !isWebUrl(cleanUrl)) {
      return setError('Upload a file, or paste a direct link starting with http:// or https://');
    }

    setSaving(true);
    let uploaded: UploadResult | null = null;
    try {
      const payload: Record<string, unknown> = { title: cleanTitle };
      if (type === 'text') payload.content = content;
      if (type === 'link') payload.url = cleanUrl;
      if (isMedia) {
        if (file) {
          setProgress(0);
          uploaded = await uploadFile(file, type as UploadKind, setProgress);
          payload.url = uploaded.url;
          payload.cloudinary_public_id = uploaded.public_id;
          payload.resource_type = uploaded.resource_type;
        } else if (!block || cleanUrl !== (block.url ?? '')) {
          // A pasted link has no Cloudinary asset behind it (the server removes any old one).
          payload.url = cleanUrl;
          payload.cloudinary_public_id = null;
          payload.resource_type = null;
        }
      }

      if (block) {
        await api.patch(`/modules/contents/${block.id}`, payload);
      } else {
        await api.post(`/modules/${moduleId}/contents`, {
          ...payload,
          module_id: moduleId,
          type,
          order_index: nextOrderIndex,
        });
      }
      onSaved(isEdit ? 'Content block updated' : 'Content block added');
    } catch (err) {
      // Don't leave a freshly uploaded file orphaned in Cloudinary.
      if (uploaded) deleteUploadedFile(uploaded.public_id, uploaded.resource_type).catch(() => undefined);
      setError(getErrorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 border-t border-border p-4">
      <div className="space-y-2">
        <Label htmlFor={`${uid}-title`}>Title</Label>
        <Input
          id={`${uid}-title`}
          autoFocus={!isEdit}
          maxLength={200}
          value={title}
          disabled={saving}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. Week 1: Introduction"
        />
      </div>

      {type === 'text' && (
        <div className="space-y-2">
          <Label>Content</Label>
          <RichTextEditor value={toEditorHtml(block?.content ?? '')} onChange={setContent} disabled={saving} />
        </div>
      )}

      {type === 'link' && (
        <div className="space-y-2">
          <Label htmlFor={`${uid}-url`}>Web link</Label>
          <Input
            id={`${uid}-url`}
            type="url"
            value={url}
            disabled={saving}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
          />
        </div>
      )}

      {isMedia && (
        <div className="space-y-3">
          {isEdit && block?.url && !file && (
            <p className="text-xs text-muted-foreground">
              Current {TYPE_META[type].label.toLowerCase()}:{' '}
              {isWebUrl(block.url) ? (
                <a href={block.url} target="_blank" rel="noopener noreferrer" className="break-all text-primary hover:underline">
                  open
                </a>
              ) : (
                'unavailable'
              )}
            </p>
          )}

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={type === 'video' ? 'video/*' : type === 'image' ? 'image/*' : undefined}
            onChange={(e) => {
              pickFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />

          {file ? (
            <div className="space-y-2 rounded-xl border border-input p-3">
              <div className="flex items-center gap-3">
                <FileText className="h-5 w-5 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{file.name}</p>
                  <p className="text-xs text-muted-foreground">{formatSize(file.size)}</p>
                </div>
                {!saving && (
                  <button
                    type="button"
                    aria-label="Remove selected file"
                    onClick={() => setFile(null)}
                    className={cn(iconButton, 'hover:bg-destructive/10 hover:text-destructive')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              {saving && (
                <div className="space-y-1">
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-secondary"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={progress}
                  >
                    <div className="h-2 rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="text-xs text-muted-foreground">Uploading… {progress}%</p>
                </div>
              )}
            </div>
          ) : (
            <button
              type="button"
              disabled={saving}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                pickFile(e.dataTransfer.files?.[0]);
              }}
              className="flex w-full flex-col items-center gap-1 rounded-xl border border-dashed border-input py-5 text-sm text-primary transition-colors hover:bg-primary/5 disabled:opacity-50"
            >
              <Upload className="h-5 w-5" />
              <span>{isEdit ? 'Replace with a new file' : 'Choose a file or drop it here'}</span>
            </button>
          )}

          {!file && (
            <div className="space-y-2">
              <Label htmlFor={`${uid}-url`}>{isEdit ? 'Direct link' : 'Or paste a direct link'}</Label>
              <Input
                id={`${uid}-url`}
                type="url"
                value={url}
                disabled={saving}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-1">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" onClick={save} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {saving ? 'Saving…' : isEdit ? 'Save block' : 'Add block'}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The block list + "add block" picker. Every change is saved instantly.
// ---------------------------------------------------------------------------

export function ModuleContentManager({ moduleId }: { moduleId: string }) {
  const { toast } = useToast();
  const [contents, setContents] = useState<ModuleContent[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingType, setAddingType] = useState<ContentType | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get<{ contents: ModuleContent[] }>(`/modules/${moduleId}/contents`);
      setContents(data.contents ?? []);
      setError('');
    } catch (err) {
      setError(getErrorMessage(err));
    }
  }, [moduleId]);

  useEffect(() => {
    setLoading(true);
    setEditingId(null);
    setAddingType(null);
    setConfirmDeleteId(null);
    load().finally(() => setLoading(false));
  }, [load]);

  const nextOrderIndex = contents.reduce((max, c) => Math.max(max, c.order_index), -1) + 1;

  const handleSaved = async (message: string) => {
    setEditingId(null);
    setAddingType(null);
    await load();
    toast({ title: message, variant: 'success' });
  };

  const move = async (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (busy || target < 0 || target >= contents.length) return;

    const next = [...contents];
    [next[index], next[target]] = [next[target], next[index]];
    setContents(next.map((c, i) => ({ ...c, order_index: i }))); // optimistic; reloaded on failure

    setBusy(true);
    try {
      await api.patch('/modules/contents/reorder', {
        contents: next.map((c, i) => ({ id: c.id, order_index: i })),
      });
    } catch (err) {
      setError(getErrorMessage(err));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (block: ModuleContent) => {
    setBusy(true);
    try {
      // The server removes the row first, then the Cloudinary file.
      await api.delete(`/modules/contents/${block.id}`);
      setConfirmDeleteId(null);
      await load();
      toast({ title: 'Content block deleted', variant: 'success' });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-semibold">Content blocks</h3>
          <p className="text-xs text-muted-foreground">Changes to blocks are saved instantly.</p>
        </div>
        <span className="text-xs text-muted-foreground">
          {contents.length} block{contents.length === 1 ? '' : 's'}
        </span>
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading content…
        </div>
      ) : contents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-input p-5 text-center text-sm text-muted-foreground">
          No content yet. Pick a block type below to start building this module.
        </div>
      ) : (
        <ol className="space-y-2">
          {contents.map((block, index) => {
            const meta = TYPE_META[block.type];
            const Icon = meta.icon;
            const editing = editingId === block.id;
            const confirming = confirmDeleteId === block.id;

            return (
              <li key={block.id} className="overflow-hidden rounded-xl border border-input bg-background">
                <div className="flex items-center gap-3 p-3">
                  {block.type === 'image' && isWebUrl(block.url) ? (
                    <img
                      src={block.url}
                      alt=""
                      loading="lazy"
                      className="h-10 w-10 shrink-0 rounded-lg object-cover"
                    />
                  ) : (
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{block.title || meta.label}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {meta.label} · {summaryOf(block)}
                    </p>
                  </div>

                  {confirming ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <span className="hidden text-xs text-muted-foreground sm:inline">Delete this block?</span>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmDeleteId(null)}>
                        Keep
                      </Button>
                      <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={() => remove(block)}>
                        Delete
                      </Button>
                    </div>
                  ) : (
                    <div data-tour={index === 0 ? 'me-block-actions' : undefined} className="flex shrink-0 items-center">
                      <button
                        type="button"
                        aria-label="Move up"
                        title="Move up"
                        disabled={busy || index === 0}
                        onClick={() => move(index, -1)}
                        className={cn(iconButton, 'hover:bg-primary/10 hover:text-primary')}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label="Move down"
                        title="Move down"
                        disabled={busy || index === contents.length - 1}
                        onClick={() => move(index, 1)}
                        className={cn(iconButton, 'hover:bg-primary/10 hover:text-primary')}
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={editing ? 'Close editor' : 'Edit block'}
                        title={editing ? 'Close editor' : 'Edit'}
                        aria-pressed={editing}
                        disabled={busy}
                        onClick={() => {
                          setAddingType(null);
                          setEditingId(editing ? null : block.id);
                        }}
                        className={cn(iconButton, 'hover:bg-primary/10 hover:text-primary', editing && 'bg-primary/15 text-primary')}
                      >
                        {editing ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
                      </button>
                      <button
                        type="button"
                        aria-label="Delete block"
                        title="Delete"
                        disabled={busy}
                        onClick={() => setConfirmDeleteId(block.id)}
                        className={cn(iconButton, 'hover:bg-destructive/10 hover:text-destructive')}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>

                {editing && (
                  <BlockEditor
                    moduleId={moduleId}
                    type={block.type}
                    block={block}
                    nextOrderIndex={nextOrderIndex}
                    onCancel={() => setEditingId(null)}
                    onSaved={handleSaved}
                  />
                )}
              </li>
            );
          })}
        </ol>
      )}

      {/* Add a block */}
      <div data-tour="me-add-block" className="rounded-xl border border-input bg-muted/30">
        <div className="p-3">
          <p className="mb-2 text-sm font-medium">Add a block</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {TYPES.map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              const selected = addingType === t;
              return (
                <button
                  key={t}
                  type="button"
                  aria-pressed={selected}
                  disabled={loading}
                  onClick={() => {
                    setEditingId(null);
                    setAddingType(selected ? null : t);
                  }}
                  className={cn(
                    'flex flex-col items-center gap-1 rounded-lg border border-input bg-background px-2 py-3 text-xs font-medium transition-colors',
                    'hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                    selected && 'border-primary bg-primary/10 text-primary',
                  )}
                >
                  <Icon className="h-5 w-5" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        {addingType && (
          <BlockEditor
            key={addingType}
            moduleId={moduleId}
            type={addingType}
            nextOrderIndex={nextOrderIndex}
            onCancel={() => setAddingType(null)}
            onSaved={handleSaved}
          />
        )}
      </div>
    </div>
  );
}
