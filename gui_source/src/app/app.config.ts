import {
  ApplicationConfig,
  ErrorHandler,
  inject,
  provideAppInitializer,
  provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';
import { GuestHelper } from './guest-helper';
import { GuestMode } from './guest';
import { HelperConnection } from './helper-connection';
import { VisitErrorHandler } from './visit-log';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // every error also goes into this visit's log, which a bug report can attach
    { provide: ErrorHandler, useClass: VisitErrorHandler },
    provideRouter(routes),
    // where the helper is, and whether it wants a passcode, has to be known before the
    // first request to it - which the app makes as it starts
    provideAppInitializer(() => inject(HelperConnection).loadPageConfig()),
    // guest mode's stand-in for the helper, in place before the first request (`guest.ts`)
    provideAppInitializer(() => void inject(GuestHelper)),
    // a guest mode preview this browser was left in, back on before anything asks the helper
    provideAppInitializer(() => inject(GuestMode).resumePreview()),
  ]
};
