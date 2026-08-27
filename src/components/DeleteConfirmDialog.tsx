import { ConfirmDialog } from "./ConfirmDialog";

interface DeleteConfirmDialogProps {
  isOpen: boolean;
  /** 删除请求进行中：确认按钮禁用并显示「删除中…」。 */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * 统一的删除二次确认窗口。样式与「下载设置」的确认窗口一致（ConfirmDialog 底座），
 * 固定文案：标题「删除确认」、内容「确认是否要删除该项目？」、
 * 按钮「取消」+ 红色「确认删除」。
 *
 * 角色、共享角色、规则条目、正则条目、知识库、知识库文章条目、
 * 自定义对话/画图模型供应商、供应商模型条目等所有删除入口共用本组件。
 */
export function DeleteConfirmDialog({
  isOpen,
  busy = false,
  onConfirm,
  onCancel,
}: DeleteConfirmDialogProps) {
  return (
    <ConfirmDialog
      isOpen={isOpen}
      title="删除确认"
      message="确认是否要删除该项目？"
      destructive
      confirmText={busy ? "删除中…" : "确认删除"}
      confirmDisabled={busy}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}