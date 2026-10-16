import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from 'react';
import {
  DocumentPanelBodies,
  DocumentPanelFrame,
  DocumentPanelProps
} from './DocumentPanel';
import PanelRail, { PanelRailProps } from './PanelRail';
import { TOOLBAR_HEIGHT } from './DocxToolbar/styles';
import type { ActivePanel } from './reviewPanelPresentation';

export interface DocumentRailSession {
  panel: DocumentPanelProps;
  rail: PanelRailProps;
  toolbarHeight: number;
}

type Register = (id: string, session: DocumentRailSession | null) => void;
const RailContext = createContext<{ register: Register } | null>(null);
export const useSharedDocumentRail = () => useContext(RailContext);

/** One frame and icon rail for the packet. Only document bodies change visibility;
 * visited bodies stay mounted to retain history rows, scroll, and review state. */
export default function SharedDocumentRail({
  children,
  activeId,
  panel,
  onPanelChange,
  enabled,
  showChanges
}: {
  children: React.ReactNode;
  activeId?: string;
  panel: ActivePanel;
  onPanelChange: (panel: ActivePanel) => void;
  enabled: boolean;
  showChanges: boolean;
}) {
  const [sessions, setSessions] = useState<Record<string, DocumentRailSession>>(
    {}
  );
  const register = useCallback<Register>((id, session) => {
    setSessions((current) => {
      if (!session && !(id in current)) return current;
      const next = { ...current };
      if (session) next[id] = session;
      else delete next[id];
      return next;
    });
  }, []);
  // Keep the context identity stable: registration rerenders the frame, not its
  // cached editor children. Editor state updates publish fresh bindings here.
  const context = useMemo(() => ({ register }), [register]);
  if (!enabled) return <>{children}</>;
  const current = activeId ? sessions[activeId] : undefined;
  return (
    <RailContext.Provider value={context}>
      {children}
      <div
        ref={(node) => {
          node?.toggleAttribute('inert', !!current?.panel.restoring);
        }}
        css={{
          position: 'absolute',
          top: current?.toolbarHeight ?? TOOLBAR_HEIGHT,
          bottom: 0,
          right: 0,
          display: 'flex',
          zIndex: 1
        }}
      >
        <DocumentPanelFrame
          {...current?.panel}
          open={panel !== null}
          tab={panel ?? 'sections'}
          animate={false}
          onClose={current?.panel.onClose ?? (() => onPanelChange(null))}
        >
          {Object.entries(sessions).map(([id, session]) => (
            <div
              key={id}
              aria-hidden={id !== activeId}
              css={{
                position: 'absolute',
                inset: 0,
                display: id === activeId ? 'block' : 'none'
              }}
            >
              <DocumentPanelBodies
                {...session.panel}
                open={panel !== null}
                tab={panel ?? 'sections'}
                active={id === activeId}
              />
            </div>
          ))}
          {!current && panel !== null && (
            <div role='status' css={{ padding: 24, fontSize: 13 }}>
              Loading document…
            </div>
          )}
        </DocumentPanelFrame>
        <PanelRail
          {...current?.rail}
          activePanel={panel}
          showChanges={current?.rail.showChanges ?? showChanges}
          changesCount={current?.rail.changesCount ?? 0}
          showHistory={current?.rail.showHistory ?? true}
          onToggle={
            current?.rail.onToggle ??
            ((next) => onPanelChange(next === panel ? null : next))
          }
        />
      </div>
    </RailContext.Provider>
  );
}
