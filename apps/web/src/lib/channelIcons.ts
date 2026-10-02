import {
  Award, BookOpen, Bell, Bus, Calculator, Calendar, Camera, ClipboardCheck, Coffee, Dumbbell, FlaskConical, FolderOpen, Gamepad2,
  Globe, GraduationCap, Hash, Heart, Laptop, Library, Lightbulb, Megaphone, MessageSquare, Microscope, Music, Palette, Pencil, Rocket,
  Smile, Star, Trophy, Users, Utensils, Volume2, type LucideIcon,
} from 'lucide-react'

/** One icon per kind of standard channel, so they read at a glance. */
export const CHANNEL_ICONS: Record<string, LucideIcon> = {
  announcements: Megaphone,
  attendance: ClipboardCheck,
  homework: BookOpen,
  chat: MessageSquare,
  resources: FolderOpen,
  books: Library,
  grades: Award,
  voice: Volume2,
  text: Hash,
}

/** Icons a person can pick for a channel they create. The key is what gets saved. */
export const PICKABLE_ICONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'hash', label: 'Hash', icon: Hash },
  { key: 'message', label: 'Chat', icon: MessageSquare },
  { key: 'megaphone', label: 'Announce', icon: Megaphone },
  { key: 'book', label: 'Book', icon: BookOpen },
  { key: 'pencil', label: 'Pencil', icon: Pencil },
  { key: 'calculator', label: 'Maths', icon: Calculator },
  { key: 'flask', label: 'Science', icon: FlaskConical },
  { key: 'microscope', label: 'Biology', icon: Microscope },
  { key: 'globe', label: 'Geography', icon: Globe },
  { key: 'laptop', label: 'Computers', icon: Laptop },
  { key: 'palette', label: 'Art', icon: Palette },
  { key: 'music', label: 'Music', icon: Music },
  { key: 'dumbbell', label: 'Sports', icon: Dumbbell },
  { key: 'trophy', label: 'Trophy', icon: Trophy },
  { key: 'gamepad', label: 'Games', icon: Gamepad2 },
  { key: 'camera', label: 'Photos', icon: Camera },
  { key: 'lightbulb', label: 'Ideas', icon: Lightbulb },
  { key: 'rocket', label: 'Projects', icon: Rocket },
  { key: 'star', label: 'Star', icon: Star },
  { key: 'heart', label: 'Heart', icon: Heart },
  { key: 'smile', label: 'Fun', icon: Smile },
  { key: 'coffee', label: 'Lounge', icon: Coffee },
  { key: 'food', label: 'Lunch', icon: Utensils },
  { key: 'bus', label: 'Transport', icon: Bus },
  { key: 'calendar', label: 'Events', icon: Calendar },
  { key: 'bell', label: 'Alerts', icon: Bell },
  { key: 'users', label: 'Group', icon: Users },
  { key: 'graduation', label: 'Exams', icon: GraduationCap },
]

const BY_KEY = new Map(PICKABLE_ICONS.map((i) => [i.key, i.icon]))

/** The icon for a channel: its chosen one if it is a custom text channel, otherwise the icon for its kind. */
export const channelIcon = (type: string, icon?: string | null): LucideIcon =>
  (type === 'text' && icon && BY_KEY.get(icon)) || CHANNEL_ICONS[type] || Hash
