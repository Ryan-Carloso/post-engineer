import { PiOpenAiLogo } from 'react-icons/pi';
import { SiClaudecode, SiCursor, SiOpencode } from 'react-icons/si';
import { cn } from '@/lib/utils';

//---------------
// AgentLogos — row of logo tiles for the MCP-capable agents the
// product names (API keys hero, prompts copy block). Decorative:
// the agent names are always in the surrounding copy, so the row
// is aria-hidden. Presentational.
//---------------

export type AgentId = 'claude' | 'openai' | 'opencode' | 'cursor';

const AGENTS: Record<AgentId, { Icon: () => React.JSX.Element; tile: string }> = {
  claude: {
    Icon: () => <SiClaudecode className="size-[62%]" />,
    tile: 'border-[#e7e2dc] bg-[#f7f5f2] text-[#D97757]',
  },
  openai: {
    Icon: () => <PiOpenAiLogo className="size-[62%]" />,
    tile: 'border-[#e7e2dc] bg-[#f7f5f2] text-[#D97757]',
  },
  opencode: {
    Icon: () => <SiOpencode className="size-[62%]" />,
    tile: 'border-[#dfe5ec] bg-white text-[#101728]',
  },
  cursor: {
    Icon: () => <SiCursor className="size-[62%]" />,
    tile: 'border-[#dfe5ec] bg-white text-[#101728]',
  },
};

export default function AgentLogos({
  agents,
  size = 'lg',
  className,
}: {
  agents: AgentId[];
  size?: 'sm' | 'lg';
  className?: string;
}) {
  return (
    <div className={cn('flex shrink-0 items-center gap-2.5', className)} aria-hidden="true">
      {agents.map((id) => {
        const { Icon, tile } = AGENTS[id];
        return (
          <span
            key={id}
            data-agent={id}
            className={cn(
              'flex items-center justify-center rounded-xl border shadow-[0_4px_12px_rgba(16,23,40,0.08)]',
              size === 'lg' ? 'size-16' : 'size-10',
              tile,
            )}
          >
            <Icon />
          </span>
        );
      })}
    </div>
  );
}
