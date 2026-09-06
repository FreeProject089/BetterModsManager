# Retours, bugs & rapports de plantage


> Le dialogue intégré qui envoie une suggestion, un bug ou un plantage au centre de retours
> BetterCommunity — ce qu'il joint, où ça va, et ce qui se passe quand le site est injoignable.

Ouvre-le depuis **Réglages → Retours & rapports de bug**, ou depuis le bouton du dialogue de
plantage. Il envoie au **centre de retours BetterCommunity** par défaut ; les anciens formulaires
BetaHub ne servent qu'en secours, quand l'appli est configurée avec un `feedback_endpoint` vide.


## Trois types

- **Suggestion** — une idée ou quelque chose à améliorer. Juste un titre et une description.
- **Bug** — quelque chose qui ne fait pas ce qu'il devrait. Ajoute les étapes ; le journal de
  l'appli est joint par défaut.
- **Plantage** — BMM s'est fermé tout seul. Le zip de plantage et un rapport DxDiag sont joints
  par défaut ; décoche l'un ou l'autre.


## Ce qui est envoyé

**Rien ne quitte ta machine tant que tu n'as pas appuyé sur Envoyer.** À ce moment, le rapport
porte :

| Élément | Quand | C'est quoi |
|---|---|---|
| Titre, description, étapes | toujours | ce que tu as saisi |
| Captures d'écran | si tu en joins | les images que tu choisis |
| Zip de plantage | si tu le joins | journaux + un instantané système + une relecture masquée des instants avant le plantage |
| Journal de l'appli | pré-coché pour bug/plantage | `bmm_frontend.log` |
| Rapport DxDiag | pré-coché pour plantage | un inventaire matériel/pilotes complet qui contient aussi des identifiants machine/OS et ton nom de compte Windows |

Ton **Creator ID** accompagne le rapport en en-tête, avec la version de l'appli, l'OS et la locale.
Le détail complet est dans la Politique de confidentialité de l'appli (§3.3).

:::warning[Le rapport DxDiag est large]
C'est le dump brut `dxdiag /t` — plus que le « profil système » de télémétrie, y compris ton nom
d'utilisateur Windows. Il n'est pré-coché que pour les plantages, et tu peux le décocher.
:::


## Réponses : lié ou anonyme

:::note[Lie ton compte]
Si ton compte BetterCommunity est lié, un rapport ouvre un **fil dans ton tableau de bord** et BMM
te notifie des réponses. Sinon, laisse un **e-mail** ou un **Discord** pour être recontacté.
:::


## Si le site est injoignable

Un rapport que BMM n'a pas pu envoyer est **gardé localement et renvoyé automatiquement au prochain
démarrage** — il n'est jamais envoyé ailleurs. BMM garde aussi une liste locale de tes 50 derniers
envois, et se limite lui-même (quelques-uns par dix minutes, quelques dizaines par jour) pour ne
rien noyer. Une petite preuve de travail anti-spam s'exécute avant l'envoi — elle coûte un peu de
CPU et n'envoie aucune donnée supplémentaire.
