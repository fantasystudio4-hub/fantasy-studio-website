/* Globals the site sets on window at runtime (no build step, so no imports). */
interface Window {
  FIREBASE_CONFIG?: {
    apiKey: string;
    authDomain: string;
    projectId: string;
    storageBucket: string;
    messagingSenderId: string;
    appId: string;
    measurementId?: string;
  };
  FSApp?: any;
  FS?: any;
  Capacitor?: any;
  dataLayer?: any[];
  gtag?: (...args: any[]) => void;
  __firebaseReady?: boolean;
  __saveLead?: (lead: any) => Promise<boolean>;
  __saveReview?: (rv: any) => Promise<boolean>;
  [key: string]: any;
}
declare var FSApp: any;
declare var grecaptcha: any;
