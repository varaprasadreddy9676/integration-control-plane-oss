import type { SVGProps } from 'react';
import { Icon as AstryxIcon, type IconSize } from '@astryxdesign/core/Icon';
import * as Lucide from 'lucide-react';
import './Icon.css';

const iconMap = {
  ApartmentOutlined: Lucide.Building2,
  ApiOutlined: Lucide.Network,
  AppstoreOutlined: Lucide.LayoutGrid,
  ArrowDownOutlined: Lucide.ArrowDown,
  ArrowLeftOutlined: Lucide.ArrowLeft,
  ArrowRightOutlined: Lucide.ArrowRight,
  ArrowUpOutlined: Lucide.ArrowUp,
  AuditOutlined: Lucide.ClipboardCheck,
  BarChartOutlined: Lucide.ChartNoAxesColumnIncreasing,
  BellOutlined: Lucide.Bell,
  BgColorsOutlined: Lucide.Palette,
  BlockOutlined: Lucide.Ban,
  BookOutlined: Lucide.BookOpen,
  BranchesOutlined: Lucide.GitBranch,
  BugOutlined: Lucide.Bug,
  BulbOutlined: Lucide.Lightbulb,
  CalendarOutlined: Lucide.CalendarDays,
  CaretDownOutlined: Lucide.ChevronDown,
  CaretRightOutlined: Lucide.ChevronRight,
  CheckCircleFilled: Lucide.CircleCheck,
  CheckCircleOutlined: Lucide.CircleCheck,
  CheckOutlined: Lucide.Check,
  ClearOutlined: Lucide.Eraser,
  ClockCircleOutlined: Lucide.Clock3,
  CloseCircleFilled: Lucide.CircleX,
  CloseCircleOutlined: Lucide.CircleX,
  CloseOutlined: Lucide.X,
  CloudServerOutlined: Lucide.CloudCog,
  ClusterOutlined: Lucide.Workflow,
  CodeOutlined: Lucide.Code,
  CopyOutlined: Lucide.Copy,
  CreditCardOutlined: Lucide.CreditCard,
  DashboardOutlined: Lucide.Gauge,
  DatabaseOutlined: Lucide.Database,
  DeleteOutlined: Lucide.Trash2,
  DeploymentUnitOutlined: Lucide.Network,
  DisconnectOutlined: Lucide.Unplug,
  DownOutlined: Lucide.ChevronDown,
  DownloadOutlined: Lucide.Download,
  EditOutlined: Lucide.Pencil,
  EllipsisOutlined: Lucide.Ellipsis,
  EnterOutlined: Lucide.CornerDownLeft,
  ExclamationCircleOutlined: Lucide.CircleAlert,
  ExperimentOutlined: Lucide.FlaskConical,
  EyeInvisibleOutlined: Lucide.EyeOff,
  EyeOutlined: Lucide.Eye,
  FieldTimeOutlined: Lucide.Timer,
  FileAddOutlined: Lucide.FilePlus,
  FileImageOutlined: Lucide.FileImage,
  FilePdfOutlined: Lucide.FileText,
  FileTextOutlined: Lucide.FileText,
  FilterOutlined: Lucide.Filter,
  FireOutlined: Lucide.Flame,
  FolderOpenOutlined: Lucide.FolderOpen,
  GlobalOutlined: Lucide.Globe,
  GithubOutlined: Lucide.Github,
  HighlightOutlined: Lucide.Highlighter,
  HistoryOutlined: Lucide.History,
  HomeOutlined: Lucide.House,
  IdcardOutlined: Lucide.IdCard,
  InboxOutlined: Lucide.Inbox,
  InfoCircleOutlined: Lucide.Info,
  KeyOutlined: Lucide.KeyRound,
  LeftOutlined: Lucide.ChevronLeft,
  LineChartOutlined: Lucide.ChartNoAxesCombined,
  LinkOutlined: Lucide.Link,
  LoadingOutlined: Lucide.LoaderCircle,
  LockOutlined: Lucide.Lock,
  LogoutOutlined: Lucide.LogOut,
  MailOutlined: Lucide.Mail,
  MenuOutlined: Lucide.Menu,
  PanelLeftClose: Lucide.PanelLeftClose,
  PanelLeftOpen: Lucide.PanelLeftOpen,
  MessageOutlined: Lucide.MessageSquare,
  MinusCircleOutlined: Lucide.CircleMinus,
  MoonOutlined: Lucide.Moon,
  MoreOutlined: Lucide.Ellipsis,
  NodeIndexOutlined: Lucide.Network,
  PauseCircleOutlined: Lucide.CirclePause,
  PieChartOutlined: Lucide.ChartPie,
  PlayCircleOutlined: Lucide.CirclePlay,
  PlusCircleOutlined: Lucide.CirclePlus,
  PlusOutlined: Lucide.Plus,
  QuestionCircleOutlined: Lucide.CircleHelp,
  RadarChartOutlined: Lucide.Radar,
  RedoOutlined: Lucide.Redo2,
  ReloadOutlined: Lucide.RefreshCw,
  RetweetOutlined: Lucide.Repeat2,
  RightOutlined: Lucide.ChevronRight,
  RocketOutlined: Lucide.Rocket,
  RollbackOutlined: Lucide.Undo2,
  SafetyCertificateOutlined: Lucide.ShieldCheck,
  SafetyOutlined: Lucide.Shield,
  SaveOutlined: Lucide.Save,
  SearchOutlined: Lucide.Search,
  SendOutlined: Lucide.Send,
  SettingOutlined: Lucide.Settings,
  StopOutlined: Lucide.CircleStop,
  SunOutlined: Lucide.Sun,
  SwapOutlined: Lucide.ArrowLeftRight,
  SyncOutlined: Lucide.RefreshCw,
  TeamOutlined: Lucide.UsersRound,
  ThunderboltOutlined: Lucide.Zap,
  UndoOutlined: Lucide.Undo2,
  UnlockOutlined: Lucide.LockOpen,
  UnorderedListOutlined: Lucide.List,
  UpOutlined: Lucide.ChevronUp,
  UploadOutlined: Lucide.Upload,
  UserOutlined: Lucide.UserRound,
  WarningFilled: Lucide.TriangleAlert,
  WarningOutlined: Lucide.TriangleAlert,
  WhatsAppOutlined: Lucide.MessageCircle,
  WifiOutlined: Lucide.Wifi,
} as const;

export type IconName = keyof typeof iconMap;

interface AppIconProps extends Omit<SVGProps<SVGSVGElement>, 'color'> {
  name: IconName;
  size?: IconSize;
  spin?: boolean;
  rotate?: number;
}

export const Icon = ({ name, size = 'sm', spin = false, rotate, className, style, ...props }: AppIconProps) => {
  const rotation = rotate === undefined ? undefined : `rotate(${rotate}deg)`;
  const iconStyle = {
    ...(style?.fontSize !== undefined
      ? { width: style.width ?? style.fontSize, height: style.height ?? style.fontSize }
      : {}),
    ...style,
    ...(rotation ? { transform: [style?.transform, rotation].filter(Boolean).join(' ') } : {}),
  };

  return (
    <AstryxIcon
      icon={iconMap[name]}
      size={size}
      className={[className, spin ? 'gateway-icon--spin' : undefined].filter(Boolean).join(' ') || undefined}
      style={iconStyle}
      {...props}
    />
  );
};
