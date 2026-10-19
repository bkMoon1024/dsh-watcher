import type {
  DiffBlockLabels,
  JsonTreeLabels,
  MarkdownLabels,
  ReadBlockLabels,
  TerminalBlockLabels,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { WorkStatus } from '../observation/fold.ts'

export const CODE_TOOLBAR_LABELS = Object.freeze({
  codeLabel: '代码块',
  wrapLabel: '自动换行',
  unwrapLabel: '取消自动换行',
})
export const MARKDOWN_LABELS: MarkdownLabels = Object.freeze({
  code: Object.freeze({
    copyLabel: '复制',
    copiedLabel: '已复制',
    toolbarLabels: CODE_TOOLBAR_LABELS,
  }),
  footnotes: '脚注',
})
export const TERMINAL_LABELS: TerminalBlockLabels = Object.freeze({
  signal: (signal: string) => `信号 ${signal}`,
  exitCode: (exitCode: number) => `退出码 ${exitCode}`,
  noExitCode: '未正常退出',
  running: '运行中',
  failed: '失败',
  done: '完成',
  copy: '复制',
  copied: '已复制',
  noOutput: '没有输出',
  collapseAria: '收起终端输出',
  collapse: '收起',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行终端输出`,
  expand: (hidden: number) => `展开 ${hidden} 行`,
})
export const READ_LABELS: ReadBlockLabels = Object.freeze({
  ...CODE_TOOLBAR_LABELS,
  window: (shown: number, total: number) => `显示 ${shown}/${total} 行`,
  copy: '复制',
  copied: '已复制',
  collapseAria: '收起文件内容',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行文件内容`,
  collapse: '收起',
  expand: (hidden: number) => `展开 ${hidden} 行`,
})
export const DIFF_LABELS: DiffBlockLabels = Object.freeze({
  ...CODE_TOOLBAR_LABELS,
  copy: '复制',
  copied: '已复制',
  collapseAria: '收起变更内容',
  expandAria: (hidden: number) => `展开其余 ${hidden} 行变更`,
  collapse: '收起',
  expand: (hidden: number) => `展开 ${hidden} 行`,
})
export const JSON_LABELS: JsonTreeLabels = Object.freeze({
  copyValue: '复制值',
  copyJson: '复制 JSON',
  copyPath: '复制路径',
  copyPrettyJson: '复制格式化 JSON',
  copyCompactJson: '复制紧凑 JSON',
  copied: '已复制',
  copyFailed: '复制失败',
  collapseNode: '收起节点',
  expandNode: '展开节点',
  copyButtonTitle: (action: string) => action,
})

export const STATUS_LABEL: Record<WorkStatus, string> = {
  running: '进行中',
  waiting: '等待你',
  success: '成功',
  failure: '失败',
  returned: '已返回',
  interrupted: '已中断',
  unknown: '未知',
}
