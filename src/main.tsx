import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import 'katex/dist/katex.min.css';
import {installCompatLayer} from './compat';
import {migrateFromLocalStorage, isMigrationDone} from './lib/idbStorage';
import {hydrateSessions} from './lib/sessionStorage';
import {hydrateExtensionSettings} from './compat/extensionSettings';
import {hydrateRegexScripts} from './compat/regex/store';
import {hydrateGlobalVariables} from './compat/variables';
import {
  MIGRATION_DIALOG_ENABLED,
  hasNyaaChatLocalStorageData,
  showMigrationConfirm,
  showMigrationComplete,
} from './lib/migrationDialog';

// Bootstrap: migrate localStorage → IndexedDB (one-shot), then hydrate every
// in-memory cache before the compat layer or React mount so synchronous reads
// throughout the app always see the latest data.
(async function bootstrap() {
  // --- 0. Transitional migration dialog --------------------------------
  // When MIGRATION_DIALOG_ENABLED is true AND the user has NyaaChat data
  // still in localStorage AND the IDB migration hasn't run yet, show a
  // blocking (non-dismissable) pre-React dialog that explains the one-time
  // migration.  After the user confirms, run the migration and show a
  // completion confirmation.
  //
  // Once the transition period ends, set MIGRATION_DIALOG_ENABLED = false
  // in migrationDialog.ts and the entire block becomes a silent no-op;
  // the plain migrateFromLocalStorage() call below handles the rest.
  // --------------------------------------------------------------------
  if (
    MIGRATION_DIALOG_ENABLED &&
    hasNyaaChatLocalStorageData() &&
    !(await isMigrationDone())
  ) {
    await showMigrationConfirm();
    await migrateFromLocalStorage();
    await showMigrationComplete();
  } else {
    // 1. One-time data migration (idempotent — sentinel in IDB prevents re-runs).
    await migrateFromLocalStorage();
  }

  // 2. Pre-fill in-memory caches from IndexedDB.
  await hydrateExtensionSettings();   // extension_settings object
  await hydrateRegexScripts();        // global regex cache
  await hydrateGlobalVariables();     // global variables cache
  await hydrateSessions();            // sessions + lastSessionId caches

  // 3. Install the SillyTavern compatibility layer.  Extensions now see
  //    hydrated data in extension_settings, regex, and variables.
  installCompatLayer();

  // 4. Mount React.
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
})();
