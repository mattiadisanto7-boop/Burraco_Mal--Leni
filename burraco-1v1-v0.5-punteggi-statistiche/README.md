# Burraco 1v1 – v0.5

Versione mobile-first per Burraco online 1 contro 1.

## Novità v0.5
- Punteggio totale sempre visibile durante la partita.
- La partita continua su più mani finché un giocatore raggiunge o supera 1005 punti (in caso di parità al vertice si continua).
- Conteggio automatico a fine mano secondo i valori F.I.Bur.: carte a terra, burraco pulito/semipulito/sporco, chiusura, carte rimaste in mano e penalità del pozzetto non preso.
- Nuova mano automatica dopo 6 secondi se nessuno ha ancora vinto la partita.
- Statistiche finali: mani vinte, pesche, raccolte scarti, carte calate, pozzetti, burrachi, chiusure e miglior mano.
- Storico locale delle ultime 50 partite sul dispositivo, con conteggio vittorie per nome.
- Audio personalizzati riprodotti tramite Web Audio API: le registrazioni vengono caricate e decodificate dopo il primo tocco, migliorando la compatibilità sui browser mobili.
- Mantiene soundboard, 2 sfondi, uscita dalla partita, stanze online, ordinamento persistente e tavolo mobile-first.

## Deploy Render
Root Directory vuota se `package.json` è nella root del repository.

Build Command:
`npm install`

Start Command:
`npm start`
