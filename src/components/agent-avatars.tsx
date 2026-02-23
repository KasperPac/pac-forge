import type { ComponentType, SVGProps } from "react";

type SvgAvatarProps = SVGProps<SVGSVGElement>;

/** Code Architect — clean-cut, slim glasses, neat side-parted hair */
function CodeArchitectAvatar(props: SvgAvatarProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      {/* Background circle */}
      <circle cx="60" cy="60" r="60" fill="#1e293b" />
      {/* Neck */}
      <rect x="49" y="88" width="22" height="12" rx="4" fill="#c4a882" />
      {/* Shirt / shoulders */}
      <path d="M30 120 C30 102, 45 95, 60 95 C75 95, 90 102, 90 120" fill="#1e40af" />
      <path d="M54 95 L60 105 L66 95" fill="#1e3a8a" />
      {/* Head */}
      <ellipse cx="60" cy="62" rx="26" ry="30" fill="#d4b896" />
      {/* Hair — neat side part */}
      <path d="M34 52 C34 30, 48 22, 62 22 C76 22, 88 30, 86 52 C86 46, 82 38, 74 34 C66 30, 50 32, 44 38 C40 42, 36 48, 34 52Z" fill="#2d1f10" />
      <path d="M34 52 C34 48, 35 44, 38 40 C41 36, 46 34, 50 33 L46 42 L34 52Z" fill="#3b2a16" />
      {/* Ears */}
      <ellipse cx="34" cy="64" rx="5" ry="7" fill="#c4a882" />
      <ellipse cx="86" cy="64" rx="5" ry="7" fill="#c4a882" />
      {/* Eyes */}
      <ellipse cx="48" cy="64" rx="3.5" ry="3.5" fill="white" />
      <ellipse cx="72" cy="64" rx="3.5" ry="3.5" fill="white" />
      <circle cx="49" cy="64" r="2" fill="#1e293b" />
      <circle cx="73" cy="64" r="2" fill="#1e293b" />
      <circle cx="49.5" cy="63.5" r="0.7" fill="white" />
      <circle cx="73.5" cy="63.5" r="0.7" fill="white" />
      {/* Slim glasses */}
      <rect x="41" y="59" width="16" height="10" rx="3" stroke="#3b82f6" strokeWidth="1.5" fill="none" />
      <rect x="63" y="59" width="16" height="10" rx="3" stroke="#3b82f6" strokeWidth="1.5" fill="none" />
      <line x1="57" y1="64" x2="63" y2="64" stroke="#3b82f6" strokeWidth="1.5" />
      <line x1="41" y1="63" x2="34" y2="61" stroke="#3b82f6" strokeWidth="1" />
      <line x1="79" y1="63" x2="86" y2="61" stroke="#3b82f6" strokeWidth="1" />
      {/* Eyebrows */}
      <path d="M42 56 Q48 53, 56 55" stroke="#2d1f10" strokeWidth="1.5" fill="none" />
      <path d="M64 55 Q72 53, 78 56" stroke="#2d1f10" strokeWidth="1.5" fill="none" />
      {/* Nose */}
      <path d="M58 68 Q60 74, 62 68" stroke="#b8976d" strokeWidth="1.2" fill="none" />
      {/* Mouth — slight confident smile */}
      <path d="M50 79 Q60 84, 70 79" stroke="#8b6f52" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/** PLC Standards Enforcer — stern, thick-rimmed glasses, raised eyebrow */
function StandardsEnforcerAvatar(props: SvgAvatarProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="60" cy="60" r="60" fill="#1e293b" />
      {/* Neck */}
      <rect x="49" y="88" width="22" height="12" rx="4" fill="#c9a67a" />
      {/* Shirt — buttoned-up collar */}
      <path d="M30 120 C30 102, 45 95, 60 95 C75 95, 90 102, 90 120" fill="#92400e" />
      <line x1="60" y1="95" x2="60" y2="120" stroke="#78350f" strokeWidth="1.5" />
      <circle cx="60" cy="100" r="1.2" fill="#fbbf24" />
      <circle cx="60" cy="107" r="1.2" fill="#fbbf24" />
      {/* Head */}
      <ellipse cx="60" cy="62" rx="27" ry="30" fill="#d4b08a" />
      {/* Hair — cropped, tidy, slightly receding */}
      <path d="M33 50 C34 28, 50 20, 62 20 C74 20, 88 28, 87 50 C87 42, 82 34, 72 30 C62 26, 48 28, 42 34 C38 38, 35 44, 33 50Z" fill="#4a3728" />
      {/* Ears */}
      <ellipse cx="33" cy="64" rx="5" ry="7" fill="#c9a67a" />
      <ellipse cx="87" cy="64" rx="5" ry="7" fill="#c9a67a" />
      {/* Eyes — slightly narrowed */}
      <ellipse cx="47" cy="64" rx="3.5" ry="3" fill="white" />
      <ellipse cx="73" cy="64" rx="3.5" ry="3" fill="white" />
      <circle cx="48" cy="64" r="2" fill="#1e293b" />
      <circle cx="74" cy="64" r="2" fill="#1e293b" />
      <circle cx="48.5" cy="63.5" r="0.7" fill="white" />
      <circle cx="74.5" cy="63.5" r="0.7" fill="white" />
      {/* Thick-rimmed glasses */}
      <rect x="39" y="58" width="18" height="12" rx="3" stroke="#f59e0b" strokeWidth="2.5" fill="none" />
      <rect x="63" y="58" width="18" height="12" rx="3" stroke="#f59e0b" strokeWidth="2.5" fill="none" />
      <line x1="57" y1="64" x2="63" y2="64" stroke="#f59e0b" strokeWidth="2" />
      <line x1="39" y1="63" x2="33" y2="61" stroke="#f59e0b" strokeWidth="1.5" />
      <line x1="81" y1="63" x2="87" y2="61" stroke="#f59e0b" strokeWidth="1.5" />
      {/* Eyebrows — one raised (skeptical) */}
      <path d="M40 54 Q47 52, 56 54" stroke="#4a3728" strokeWidth="2" fill="none" />
      <path d="M64 52 Q72 49, 80 53" stroke="#4a3728" strokeWidth="2" fill="none" />
      {/* Nose */}
      <path d="M57 68 Q60 75, 63 68" stroke="#b08a64" strokeWidth="1.3" fill="none" />
      {/* Mouth — firm, straight line with slight frown */}
      <path d="M48 80 Q60 78, 72 80" stroke="#8b6b4a" strokeWidth="1.8" fill="none" />
    </svg>
  );
}

/** IO Validator — headset, focused look, tech-savvy */
function IoValidatorAvatar(props: SvgAvatarProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="60" cy="60" r="60" fill="#1e293b" />
      {/* Neck */}
      <rect x="49" y="88" width="22" height="12" rx="4" fill="#b8956c" />
      {/* Shirt — tech polo */}
      <path d="M30 120 C30 102, 45 95, 60 95 C75 95, 90 102, 90 120" fill="#065f46" />
      <path d="M55 95 L55 105" stroke="#047857" strokeWidth="1" />
      <path d="M65 95 L65 105" stroke="#047857" strokeWidth="1" />
      {/* Head */}
      <ellipse cx="60" cy="62" rx="26" ry="29" fill="#d0a878" />
      {/* Hair — short buzz cut with fade */}
      <path d="M34 54 C34 30, 48 23, 60 23 C72 23, 86 30, 86 54 C86 44, 80 36, 72 32 C64 28, 56 28, 48 32 C40 36, 34 44, 34 54Z" fill="#1a1a2e" />
      {/* Ears */}
      <ellipse cx="34" cy="64" rx="5" ry="7" fill="#b8956c" />
      <ellipse cx="86" cy="64" rx="5" ry="7" fill="#b8956c" />
      {/* Headset band */}
      <path d="M28 56 C28 38, 44 26, 60 26 C76 26, 92 38, 92 56" stroke="#334155" strokeWidth="3" fill="none" />
      {/* Headset earpiece — left */}
      <rect x="24" y="56" width="10" height="16" rx="3" fill="#475569" />
      <rect x="26" y="58" width="6" height="12" rx="2" fill="#10b981" opacity="0.3" />
      {/* Headset mic */}
      <path d="M28 72 Q28 82, 42 82" stroke="#475569" strokeWidth="2.5" fill="none" />
      <ellipse cx="43" cy="82" rx="3" ry="2.5" fill="#475569" />
      <ellipse cx="43" cy="82" rx="1.5" ry="1.5" fill="#10b981" opacity="0.5" />
      {/* Eyes — alert, focused */}
      <ellipse cx="48" cy="64" rx="4" ry="3.5" fill="white" />
      <ellipse cx="72" cy="64" rx="4" ry="3.5" fill="white" />
      <circle cx="49" cy="64" r="2.2" fill="#1e293b" />
      <circle cx="73" cy="64" r="2.2" fill="#1e293b" />
      <circle cx="49.5" cy="63.2" r="0.8" fill="white" />
      <circle cx="73.5" cy="63.2" r="0.8" fill="white" />
      {/* Eyebrows — focused, slightly angled */}
      <path d="M41 57 Q48 55, 55 57" stroke="#1a1a2e" strokeWidth="1.8" fill="none" />
      <path d="M65 57 Q72 55, 79 57" stroke="#1a1a2e" strokeWidth="1.8" fill="none" />
      {/* Nose */}
      <path d="M58 68 Q60 74, 62 68" stroke="#a6825e" strokeWidth="1.2" fill="none" />
      {/* Mouth — slight determined smile */}
      <path d="M50 79 Q60 82, 70 79" stroke="#8b6b4a" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

/** Safety Auditor — hard hat, serious, strong jaw */
function SafetyAuditorAvatar(props: SvgAvatarProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="60" cy="60" r="60" fill="#1e293b" />
      {/* Neck — thicker */}
      <rect x="47" y="88" width="26" height="12" rx="4" fill="#c9a67a" />
      {/* Shirt — high-vis vest */}
      <path d="M28 120 C28 100, 44 94, 60 94 C76 94, 92 100, 92 120" fill="#7f1d1d" />
      <path d="M32 108 Q60 100, 88 108" stroke="#fbbf24" strokeWidth="2.5" />
      <path d="M34 114 Q60 106, 86 114" stroke="#fbbf24" strokeWidth="2.5" />
      {/* Head — slightly wider jaw */}
      <path d="M34 58 C34 38, 44 32, 60 32 C76 32, 86 38, 86 58 C86 70, 82 82, 76 88 C70 92, 50 92, 44 88 C38 82, 34 70, 34 58Z" fill="#d4b08a" />
      {/* Hard hat */}
      <path d="M28 48 C28 28, 44 18, 60 18 C76 18, 92 28, 92 48 L88 48 C88 32, 76 24, 60 24 C44 24, 32 32, 32 48Z" fill="#ef4444" />
      <rect x="26" y="46" width="68" height="6" rx="2" fill="#dc2626" />
      <rect x="26" y="46" width="68" height="2" rx="1" fill="#fca5a5" opacity="0.3" />
      {/* Hard hat brim highlight */}
      <path d="M30 48 Q60 44, 90 48" stroke="#fca5a5" strokeWidth="0.5" opacity="0.4" />
      {/* Ears */}
      <ellipse cx="34" cy="64" rx="5" ry="7" fill="#c9a67a" />
      <ellipse cx="86" cy="64" rx="5" ry="7" fill="#c9a67a" />
      {/* Eyes — serious, direct */}
      <ellipse cx="48" cy="62" rx="3.5" ry="3" fill="white" />
      <ellipse cx="72" cy="62" rx="3.5" ry="3" fill="white" />
      <circle cx="49" cy="62" r="2" fill="#1e293b" />
      <circle cx="73" cy="62" r="2" fill="#1e293b" />
      <circle cx="49.5" cy="61.5" r="0.7" fill="white" />
      <circle cx="73.5" cy="61.5" r="0.7" fill="white" />
      {/* Eyebrows — thick, commanding */}
      <path d="M41 55 Q48 52, 55 54" stroke="#4a3728" strokeWidth="2.5" fill="none" />
      <path d="M65 54 Q72 52, 79 55" stroke="#4a3728" strokeWidth="2.5" fill="none" />
      {/* Nose — broader */}
      <path d="M56 66 Q60 74, 64 66" stroke="#b08a64" strokeWidth="1.5" fill="none" />
      {/* Mouth — firm, no-nonsense */}
      <path d="M48 80 L72 80" stroke="#8b6b4a" strokeWidth="2" />
      {/* Chin line */}
      <path d="M46 86 Q60 92, 74 86" stroke="#c4a07a" strokeWidth="0.8" fill="none" opacity="0.5" />
    </svg>
  );
}

/** Pattern Librarian — round glasses, tousled hair, warm expression */
function PatternLibrarianAvatar(props: SvgAvatarProps) {
  return (
    <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" {...props}>
      <circle cx="60" cy="60" r="60" fill="#1e293b" />
      {/* Neck */}
      <rect x="50" y="88" width="20" height="12" rx="4" fill="#c9a67a" />
      {/* Shirt — cozy cardigan/sweater */}
      <path d="M30 120 C30 102, 45 95, 60 95 C75 95, 90 102, 90 120" fill="#5b21b6" />
      <path d="M60 95 L60 120" stroke="#4c1d95" strokeWidth="1" />
      <path d="M48 98 Q60 102, 72 98" stroke="#7c3aed" strokeWidth="1" opacity="0.5" />
      {/* Head */}
      <ellipse cx="60" cy="62" rx="25" ry="29" fill="#d4b08a" />
      {/* Hair — tousled, wavy, slightly messy */}
      <path d="M35 50 C33 28, 48 20, 60 20 C72 20, 87 28, 85 50" fill="#5c3a1e" />
      <path d="M35 50 C36 42, 40 34, 48 30 C56 26, 64 26, 72 30 C80 34, 84 42, 85 50" fill="#6b4423" />
      {/* Tousled bits sticking up */}
      <path d="M42 28 Q38 18, 44 22" fill="#5c3a1e" />
      <path d="M54 22 Q52 12, 58 18" fill="#6b4423" />
      <path d="M68 22 Q72 14, 70 20" fill="#5c3a1e" />
      <path d="M78 28 Q82 20, 78 24" fill="#6b4423" />
      {/* Hair texture lines */}
      <path d="M40 38 Q48 32, 56 36" stroke="#4a2f14" strokeWidth="0.8" fill="none" opacity="0.4" />
      <path d="M58 34 Q66 30, 76 36" stroke="#4a2f14" strokeWidth="0.8" fill="none" opacity="0.4" />
      {/* Ears */}
      <ellipse cx="35" cy="64" rx="5" ry="7" fill="#c9a67a" />
      <ellipse cx="85" cy="64" rx="5" ry="7" fill="#c9a67a" />
      {/* Eyes — warm, slightly wider */}
      <ellipse cx="48" cy="64" rx="4" ry="3.5" fill="white" />
      <ellipse cx="72" cy="64" rx="4" ry="3.5" fill="white" />
      <circle cx="49" cy="64.5" r="2.2" fill="#3b2a16" />
      <circle cx="73" cy="64.5" r="2.2" fill="#3b2a16" />
      <circle cx="49.5" cy="63.8" r="0.8" fill="white" />
      <circle cx="73.5" cy="63.8" r="0.8" fill="white" />
      {/* Round glasses */}
      <circle cx="48" cy="64" r="9" stroke="#8b5cf6" strokeWidth="1.8" fill="none" />
      <circle cx="72" cy="64" r="9" stroke="#8b5cf6" strokeWidth="1.8" fill="none" />
      <line x1="57" y1="64" x2="63" y2="64" stroke="#8b5cf6" strokeWidth="1.5" />
      <line x1="39" y1="62" x2="35" y2="60" stroke="#8b5cf6" strokeWidth="1" />
      <line x1="81" y1="62" x2="85" y2="60" stroke="#8b5cf6" strokeWidth="1" />
      {/* Eyebrows — relaxed, friendly */}
      <path d="M41 53 Q48 51, 55 53" stroke="#5c3a1e" strokeWidth="1.5" fill="none" />
      <path d="M65 53 Q72 51, 79 53" stroke="#5c3a1e" strokeWidth="1.5" fill="none" />
      {/* Nose */}
      <path d="M58 68 Q60 74, 62 68" stroke="#b08a64" strokeWidth="1.2" fill="none" />
      {/* Mouth — warm, gentle smile */}
      <path d="M48 79 Q54 84, 60 84 Q66 84, 72 79" stroke="#8b6b4a" strokeWidth="1.5" fill="none" />
    </svg>
  );
}

const AVATAR_MAP: Record<string, ComponentType<SvgAvatarProps>> = {
  "Code Architect": CodeArchitectAvatar,
  "PLC Standards Enforcer": StandardsEnforcerAvatar,
  "IO Validator": IoValidatorAvatar,
  "Safety Auditor": SafetyAuditorAvatar,
  "Pattern Librarian": PatternLibrarianAvatar,
};

/**
 * Returns the SVG avatar component for a given agent display name,
 * or undefined if no custom avatar exists.
 */
export function getAgentAvatar(
  displayName: string
): ComponentType<SvgAvatarProps> | undefined {
  return AVATAR_MAP[displayName];
}
