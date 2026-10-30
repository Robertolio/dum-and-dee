// Prints a fresh VAPID key pair for Web Push. Nothing is written to disk: copy the values into Railway variables.
import webpush from '../packages/social/node_modules/web-push/src/index.js';

const k = webpush.generateVAPIDKeys();
console.log('Set these as environment variables (e.g. in Railway). Keep the private key secret.\n');
console.log(`VAPID_PUBLIC_KEY=${k.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${k.privateKey}`);
console.log('VAPID_SUBJECT=mailto:you@example.com   # replace with your own contact address');
