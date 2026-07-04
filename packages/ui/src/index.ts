// @intra/ui — design-system primitives + semantic tokens ported from the
// warehouse app's components/ui (LLD §13, ADR-003). Semantic tokens live in
// ./styles.css; the Tailwind preset in @intra/config references those vars.

export { Icon, type IconName } from './Icon';

export {
  Card,
  SectionTitle,
  PageHeader,
  StatCard,
  Badge,
  EmptyState,
  Field,
  BarRow,
  type Tone,
} from './primitives';

export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from './Button';
export { Input, type InputProps, Textarea, type TextareaProps } from './Input';

export { money, compactMoney, number, relativeTime } from './format';

export { Sheet } from './Sheet';
export { ToastProvider, useToast } from './Toast';
export { Skeleton, SkeletonCard, SkeletonStats, SkeletonList } from './Skeleton';
export { SegmentedControl } from './SegmentedControl';
export {
  ProductSelect,
  type ProductSelectItem,
  type ProductFamily,
} from './ProductSelect';
export { QuantityStepper } from './QuantityStepper';
export { Sparkline } from './Sparkline';
export { Fab } from './Fab';
export { DataTable, type Column } from './DataTable';
