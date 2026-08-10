# Burraco 1v1 – v0.6

Versione mobile-first per Burraco online 1 contro 1.

## Novità v0.6
- A fine mano il riepilogo dei punti resta aperto: non parte più automaticamente la mano successiva.
- Pulsante **Mano successiva**: basta che lo prema uno dei due giocatori e la nuova mano parte per entrambi.
- Nel riepilogo restano visibili i dati della mano appena conclusa e il punteggio totale della partita.
- Pulsante **Torna al menu** nella stanza di attesa, così una stanza creata per errore può essere annullata senza restare bloccati.
- Pulsante **Torna al menu** anche a fine partita e dopo un abbandono.
- Se un giocatore abbandona anche tra una mano e l'altra, l'altro riceve la vittoria per abbandono e può rientrare al menu.
- Correzione audio: la vecchia registrazione etichettata “Hai finito di vivere” è ora **“Stai facendo il gioco degli stupidi”**.
- Aggiunta la nuova registrazione corretta **“Hai finito di vivere”** con un file separato, così i browser non riutilizzano per errore l'audio vecchio dalla cache.

Restano incluse tutte le funzioni v0.5: punteggio sempre visibile, partita a 1005 punti, statistiche finali, storico locale vittorie, soundboard, due sfondi, audio/SFX, stanze online e interfaccia mobile-first.

## Deploy Render
Se `package.json` è nella pagina principale del repository GitHub, lascia **Root Directory vuota**.

Build Command: `npm install`

Start Command: `npm start`
