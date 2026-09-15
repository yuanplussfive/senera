import {
  ArrowDownTrayIcon,
  ArrowPathIcon,
  ArrowRightOnRectangleIcon,
  ArrowTopRightOnSquareIcon,
  ArrowUturnLeftIcon,
  ArrowsPointingInIcon,
  ArrowsRightLeftIcon,
  ArchiveBoxIcon,
  Bars3Icon,
  BookOpenIcon,
  CameraIcon,
  CalendarDaysIcon,
  ChatBubbleLeftEllipsisIcon,
  ChatBubbleLeftIcon,
  CheckCircleIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ClockIcon,
  CodeBracketIcon,
  CodeBracketSquareIcon,
  CommandLineIcon,
  CpuChipIcon,
  Cog6ToothIcon,
  CursorArrowRaysIcon,
  CubeIcon,
  DocumentTextIcon,
  EllipsisHorizontalIcon,
  ExclamationCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderIcon,
  GlobeAltIcon,
  InformationCircleIcon,
  KeyIcon,
  LinkIcon,
  LanguageIcon,
  MagnifyingGlassIcon,
  MapIcon,
  MinusIcon,
  PencilSquareIcon,
  PhotoIcon,
  PlusIcon,
  QueueListIcon,
  ServerIcon,
  ShareIcon,
  SignalIcon,
  SignalSlashIcon,
  Square2StackIcon,
  StopIcon,
  SwatchIcon,
  TrashIcon,
  UserGroupIcon,
  UserIcon,
  WifiIcon,
  WrenchScrewdriverIcon,
  XCircleIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import { GripVertical, MessageCirclePlus, PanelLeftClose, PanelLeftOpen, SunMoon, UserRoundPen } from "lucide-react";
import type { SVGProps } from "react";
import { cn } from "../../lib/util";

/**
 * A deliberately scoped semantic icon vocabulary for product UI and application activity.
 * Keep arbitrary icon selection out of feature code so visual language stays coherent.
 */
const AppIconCatalog = {
  activity: SignalIcon,
  brain: CpuChipIcon,
  "calendar-clock": CalendarDaysIcon,
  cancel: XCircleIcon,
  check: CheckCircleIcon,
  checkmark: CheckIcon,
  "chevron-down": ChevronDownIcon,
  "chevron-right": ChevronRightIcon,
  close: XMarkIcon,
  clock: ClockIcon,
  code: CodeBracketIcon,
  "file-code": CodeBracketSquareIcon,
  "file-text": DocumentTextIcon,
  eye: EyeIcon,
  "eye-off": EyeSlashIcon,
  alert: ExclamationCircleIcon,
  "git-branch": ShareIcon,
  delegation: ArrowsRightLeftIcon,
  globe: GlobeAltIcon,
  language: LanguageIcon,
  image: PhotoIcon,
  info: InformationCircleIcon,
  link: LinkIcon,
  folder: FolderIcon,
  palette: SwatchIcon,
  route: MapIcon,
  server: ServerIcon,
  target: CursorArrowRaysIcon,
  loading: ArrowPathIcon,
  message: ChatBubbleLeftIcon,
  "message-question": ChatBubbleLeftEllipsisIcon,
  package: CubeIcon,
  pencil: PencilSquareIcon,
  "new-session": MessageCirclePlus,
  search: MagnifyingGlassIcon,
  terminal: CommandLineIcon,
  trash: TrashIcon,
  tools: WrenchScrewdriverIcon,
  users: UserGroupIcon,
  warning: ExclamationTriangleIcon,
  copy: Square2StackIcon,
  download: ArrowDownTrayIcon,
  "external-link": ArrowTopRightOnSquareIcon,
  plus: PlusIcon,
  refresh: ArrowPathIcon,
  undo: ArrowUturnLeftIcon,
  archive: ArchiveBoxIcon,
  "book-open": BookOpenIcon,
  camera: CameraIcon,
  "file-json": DocumentTextIcon,
  grip: GripVertical,
  key: KeyIcon,
  "list-tree": QueueListIcon,
  login: ArrowRightOnRectangleIcon,
  menu: Bars3Icon,
  minus: MinusIcon,
  more: EllipsisHorizontalIcon,
  "panel-left-close": PanelLeftClose,
  "panel-left-open": PanelLeftOpen,
  "panel-right-close": ArrowsPointingInIcon,
  settings: Cog6ToothIcon,
  "account-menu": ChevronDownIcon,
  "sun-moon": SunMoon,
  maximize: StopIcon,
  restore: Square2StackIcon,
  user: UserIcon,
  "user-round-pen": UserRoundPen,
  wifi: WifiIcon,
  "wifi-off": SignalSlashIcon,
} as const;

export type AppIconName = keyof typeof AppIconCatalog;

export function AppIcon({
  icon,
  size = 16,
  strokeWidth = 1.75,
  className,
  ...props
}: Omit<SVGProps<SVGSVGElement>, "height" | "width" | "strokeWidth"> & {
  icon: AppIconName;
  size?: number | string;
  strokeWidth?: number;
}): JSX.Element {
  const Icon = AppIconCatalog[icon];
  const ariaHidden = props["aria-hidden"] ?? (props["aria-label"] || props["aria-labelledby"] ? undefined : true);

  return (
    <Icon
      {...props}
      aria-hidden={ariaHidden}
      width={size}
      height={size}
      strokeWidth={strokeWidth}
      className={cn("shrink-0", className)}
    />
  );
}
