// @intra/ui — design-system primitives + semantic tokens ported from the
// warehouse app's components/ui (LLD §13, ADR-003). Semantic tokens live in
// ./styles.css; the Tailwind preset in @intra/config references those vars.

export { Icon, type IconName } from "./Icon";
export { ContextualHelpLink } from "./ContextualHelpLink";
export { AccessDenied, type AccessDeniedProps } from "./AccessDenied";

export {
  Card,
  SectionTitle,
  PageHeader,
  StatCard,
  Badge,
  EmptyState,
  Field,
  BarRow,
  ModuleHero,
  HeroChipButton,
  HeroStat,
  type Tone,
} from "./primitives";

export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
} from "./Button";
export { Input, type InputProps, Textarea, type TextareaProps } from "./Input";

export { money, compactMoney, number, relativeTime } from "./format";

export { Sheet } from "./Sheet";
export { ToastProvider, useToast } from "./Toast";
export {
  Skeleton,
  SkeletonCard,
  SkeletonStats,
  SkeletonList,
} from "./Skeleton";
export { SegmentedControl } from "./SegmentedControl";
export {
  ProductSelect,
  type ProductSelectItem,
  type ProductFamily,
} from "./ProductSelect";
export { QuantityStepper } from "./QuantityStepper";
export { Sparkline } from "./Sparkline";
export { Fab } from "./Fab";
export { DataTable, type Column, type DataTableDensity } from "./DataTable";
export {
  SignaturePad,
  type SignaturePayload,
  type SignatureMethod,
} from "./SignaturePad";
export { InfoTip, type InfoTipProps } from "./Tooltip";
export { SignInPrompt, type SignInPromptProps } from "./SignInPrompt";
export { StatValue } from "./StatValue";

// ---- motion system (framer-motion, LazyMotion-strict) ----
export { MotionProvider } from "./motion/MotionProvider";
export {
  AnimatedNumber,
  type AnimatedNumberProps,
} from "./motion/AnimatedNumber";
export {
  StaggerGrid,
  StaggerItem,
  type StaggerGridProps,
} from "./motion/StaggerGrid";
export {
  PageTransition,
  type PageTransitionProps,
} from "./motion/PageTransition";
export { Collapse, type CollapseProps } from "./motion/Collapse";
export {
  DURATION,
  EASE_OUT,
  SPRING_SNAPPY,
  SPRING_GENTLE,
  staggerContainer,
  staggerItem,
  pageVariants,
} from "./motion/tokens";

// ---- charts (dependency-free SVG) ----
export {
  AreaChart,
  type AreaChartProps,
  type AreaChartPoint,
} from "./charts/AreaChart";
export {
  DonutChart,
  type DonutChartProps,
  type DonutSlice,
} from "./charts/DonutChart";
export { TrendChip, type TrendChipProps } from "./charts/TrendChip";
