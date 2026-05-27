import './index.css';

import { context, requestExpandedMode } from '@devvit/web/client';
import { StrictMode, useState, type MouseEvent } from 'react';
import { createRoot } from 'react-dom/client';

export const Splash = () => {
  const displayUsername = context.username ?? 'moderator';
  const normalizedDisplayUsername = displayUsername.startsWith('u/')
    ? displayUsername
    : `u/${displayUsername}`;
  const [launchError, setLaunchError] = useState<string | null>(null);

  const openWorkspace = async (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setLaunchError(null);
    try {
      await requestExpandedMode(event.nativeEvent, 'game');
    } catch {
      setLaunchError('Could not open ModAnchor workspace. Please refresh and try again.');
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-900 px-4 py-5">
      <div className="mx-auto max-w-xl rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 inline-flex items-center rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
          Private Mod Tool
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">ModAnchor</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          Safely onboard new moderators with Review Mode, senior approvals, monitored actions, and review reports.
        </p>
        <p className="mt-2 text-sm text-slate-500">
          Signed in as <span className="font-medium text-slate-700">{normalizedDisplayUsername}</span>
        </p>

        <button
          className="mt-5 w-full rounded-xl bg-blue-700 px-4 py-3 text-sm font-semibold text-white transition hover:bg-blue-800"
          onClick={(e) => void openWorkspace(e)}
        >
          Open ModAnchor
        </button>
        {launchError && <p className="mt-2 text-xs text-slate-600">{launchError}</p>}
      </div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
