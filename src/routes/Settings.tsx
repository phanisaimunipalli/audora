import { useState } from 'react';
import { useAudora } from '@/state/store';
import { seedDemo } from '@/state/seed';
import { requestNotifications, notificationPermission } from '@/lib/notify';
import { Button, Card, Chip, Field, Input, SectionTitle, Toggle, Callout } from '@/components/ui';

export default function Settings() {
  const settings = useAudora((s) => s.settings);
  const set = useAudora((s) => s.setSettings);
  const providers = useAudora((s) => s.providers);
  const resetAll = useAudora((s) => s.resetAll);
  const [perm, setPerm] = useState(notificationPermission());
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-12 md:px-6">
      <SectionTitle eyebrow="Settings" title="How Audora runs on this machine." />
      <Card className="flex flex-col gap-4">
        <div className="micro">Providers</div>
        {/* Provider state is not a fit verdict, so it is never green — and it has to agree with the
            toggle 100 px below it: a key present with "prefer simulated" on is not "live". */}
        <Callout
          tone="info"
          title={!providers.marble ? 'World Labs Marble is mocked' : settings.preferMock ? 'World Labs Marble: key present, simulated by choice' : 'World Labs Marble is live'}
        >
          {!providers.marble
            ? 'Add WORLDLABS_API_KEY to .env and restart the dev server to reconstruct real rooms. Until then, reconstruction is simulated with honest timing and cost numbers.'
            : settings.preferMock
              ? `A key is set for ${providers.models?.marbleDraft ?? 'marble-1.0-draft'} (draft) and ${providers.models?.marbleFull ?? 'marble-1.1'} (full), but "Prefer simulated reconstruction" is on below, so new generations are simulated and spend no credits.`
              : `Generations call the real API with ${providers.models?.marbleDraft ?? 'marble-1.0-draft'} (draft) and ${providers.models?.marbleFull ?? 'marble-1.1'} (full), and spend real credits.`}
        </Callout>
        <Callout tone="info" title={providers.nebius ? 'Nebius Token Factory is live' : 'Nebius Token Factory is mocked'}>
          {providers.nebius
            ? `Photo analysis uses ${providers.models?.vision}, staging uses ${providers.models?.text}, quick parsing uses ${providers.models?.fast}.`
            : 'Add NEBIUS_API_KEY to .env to run photo analysis, auto staging and listing copy on open models. The rule-based fallbacks stay in place either way.'}
        </Callout>
      </Card>
      <Card className="flex flex-col gap-4">
        <div className="micro">Reconstruction</div>
        <Toggle checked={settings.preferMock} onChange={(v) => set({ preferMock: v })} label="Prefer simulated reconstruction (no credits spent, even with a Marble key)" />
        {providers.marble ? <p className="mono text-xs text-dim">live generations this server session: {providers.liveGenerations ?? 0} / {providers.maxGenerations ?? 3} (raise MARBLE_MAX_GENERATIONS in .env)</p> : null}
      </Card>
      <Card className="flex flex-col gap-4">
        <div className="micro">Simulated generation timing (mock mode)</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Draft world, seconds"><Input type="number" min={5} value={settings.mockDraftSeconds} onChange={(e) => set({ mockDraftSeconds: Number(e.target.value) })} /></Field>
          <Field label="Full world, seconds"><Input type="number" min={5} value={settings.mockFullSeconds} onChange={(e) => set({ mockFullSeconds: Number(e.target.value) })} /></Field>
        </div>
        <Toggle checked={settings.sound} onChange={(v) => set({ sound: v })} label="Play a chime when a tour finishes" />
      </Card>
      <Card className="flex flex-col gap-4">
        <div className="micro">Notifications</div>
        <p className="text-sm text-dim">Generation takes minutes. Allow notifications and you can leave the tab; we will tell you when the tour is ready.</p>
        {perm === 'granted' ? (
          <Chip mono className="self-start">browser notifications on</Chip>
        ) : perm === 'unsupported' ? (
          <Chip mono className="self-start">this browser does not support notifications</Chip>
        ) : (
          <div className="flex items-center gap-3">
            <Button variant="primary" onClick={async () => setPerm(await requestNotifications())}>Allow browser notifications</Button>
            <span className="mono text-xs text-dim">{perm === 'denied' ? 'blocked in the browser settings' : 'not asked yet'}</span>
          </div>
        )}
      </Card>
      <Card className="flex flex-col gap-4">
        <div className="micro">Agent identity</div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={settings.agentName} onChange={(e) => set({ agentName: e.target.value })} /></Field>
          <Field label="Brand colour">
            <label className="flex h-10 items-center gap-3 rounded-[10px] border border-line-2 bg-bg px-3 transition-colors focus-within:border-ink focus-within:ring-[3px] focus-within:ring-accent-soft">
              <span className="h-5 w-5 shrink-0 rounded-full border border-line-2" style={{ background: settings.brandColor }} aria-hidden />
              <span className="mono text-sm text-ink">{settings.brandColor.toUpperCase()}</span>
              <input type="color" value={settings.brandColor} onChange={(e) => set({ brandColor: e.target.value })} className="ml-auto h-6 w-8 cursor-pointer border-0 bg-transparent p-0" aria-label="Brand colour" />
            </label>
          </Field>
        </div>
      </Card>
      <Card className="flex flex-col gap-3">
        <div className="micro">Data</div>
        <p className="text-sm text-dim">Everything lives in this browser's storage. Reset clears your tours and re-seeds the demo listing.</p>
        <div>
          <ResetButton onReset={() => { resetAll(); seedDemo(); }} />
        </div>
      </Card>
    </div>
  );
}

function ResetButton({ onReset }: { onReset: () => void }) {
  const [armed, setArmed] = useState(false);
  return (
    <Button variant="danger" onClick={() => { if (armed) { onReset(); setArmed(false); } else { setArmed(true); window.setTimeout(() => setArmed(false), 4000); } }}>
      {armed ? 'Click again to confirm' : 'Reset and re-seed demo'}
    </Button>
  );
}
