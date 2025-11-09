# 0 - Vocabulaire
## Terrain
- ```md
    R1  V   R2
    R3  R4  R5
    ```
- Les emplacement Rx sont les rear guard
- L'emplacemnt V est le vanguard
- Les emplacements R1 V R2 sont la front row
- Les emplaceements R3 R4 R5 sont la back row

## Terms
- Draw => pioche
- Unité => carte avec un grade et une attaque
- Ride => mechanique de poser une unité sur le Vanguard on ne peu ride que un grade supérieur de 1 ou égale, uniquement en ride phase, on peu ride de la main ou du ride deck dans quel cas on défausse un carte
- Call => mechanique de poser une unité de la main sur un emplacement Rx, uniquement en main phase et d'un grade inférieur ou égale au vanguard
- Guard => lors d'une attaque, l'adversaire peut poser des carte de sa main en guard zone dans quel cas on ajoute la défense de cette carte a l'attaque du vanguard pour cette attaque, le unité en guard zone sont envoyé en drop après l'attaque
- Check => Action de révéler la carte du dessus du deck ( on la pose en trigger zone ), si un trigger est révélé il est activé :
    - Heal : si les dommage du joueur sont >= a ceux de l'adversaire il peut en choisir un et l'envoyer en drop, puis il choisi une de ses unité et elle gagne +10000 atk jusqu'a la fin du tour 
    - Critical : le joueur choisi une unité et lui donne +1 critical jusqu'a la fin du tour, puis il choisi une de ses unité et elle gagne +10000 atk jusqu'a la fin du tour ( ça peut être la même pour les deux )
    - Draw : le joueur pioche, puis il choisi une de ses unité et elle gagne +10000 atk jusqu'a la fin du tour
    - Front : Les unités actuellement en front row gagnent +10000 atk jusqu'a la fin du tour
- Damage Check => quand le vanguard reçois un dommage il effectue un check puis pose la carte dans la damage zone
- Skills => compétence d'une carte elle peuvent être de base ou acquis :
    - Drive check : acquis par defaut par le vanguard ( l'emplacement donne drive check ), lorsque l'unité attaque après la guard de l'adversaire on effectue un check
    - Twin Drive : remplace Drive check si présent, lorsque l'unité attaque après la guard de l'adversaire on effectue 2 check
    - Triple Drive : remplace Drive check/Twin Drive si présent, lorsque l'unité attaque après la guard de l'adversaire on effectue 3 check
    - Quadra Drive : remplace Drive check/Twin Drive/Triple Drive, lorsque l'unité attaque après la guard de l'adversaire on effectue 4 check
    - Quinta Drive : remplace Drive check/Twin Drive/Triple Drive/Quadra Drive, lorsque l'unité attaque après la guard de l'adversaire on effectue 5 check
    - Intercept : lors de la phase de guard si l'unité est en front row elle peut être utilisé pour guard ( on la deplace en guard zone )
    - Boost : lors qu'une carte attaque en front row on peut engagé une carte derrière elle ( ex : R1 attaque on peut engager R3 ), jusqu'a la fin de l'attaque l'unité attaquant gagne l'attaque de l'unité qui boost 
- Attaque => mechanique ou on incline une carte vertical en front row pour lancé une attaque sur une unité de la front row adverse, si l'attaque passe ( si elle est supérieur ou égale a l'attaque de l'unité ciblé ) :
    - Sur le vanguard elle inflige le nombre de critique en dommage au vanguard
    - Sur un rear guard le rear guard est détruit
  Une attaque se déroule de la façon suivante : On engage l'unité => on peu boost si voulu => on cible l'unité a attaquer => l'adversaire guard ou pas => si on a le skill drive ou superieur on check => on resous l'attaque
- Move => Le joueur peut echangé les Rear entre les emplacement R1 <=> R3 et R2 <=> R5 si un des emplacemet est vide on déplace juste la carte


## Les effets
### types d'effets

Les cartes peuvent possèder 3 type d'effets :
- les effets continu "CONT" : ils sont actif tant que la condition est respecté
- les effets activable "ACT" : ils ne sont activable que pendant la Main Phase par le joueur
- les effets auto "AUTO" : ils s'activent sur un event :
    - Events associé ON_TURN_START, ON_STAND_PHASE_START, ON_STAND_PHASE_END, ON_DRAW_PHASE_START, ON_DRAW, ON_DRAW_PHASE_END, ON_RIDE_PHASE_START, ON_RIDE, ON_RIDE_PHASE_END, ON_STRIDE_PHASE, ON_STRIDE, ON_STRIDE_PHASE_END, ON_MAIN_PHASE_START, ON_CALL, ON_MOVE, ON_SENT_TO_DROP, ON_SENT_TO_SOUL, ON_SOUL_CHARGE, ON_COUNTER_BLAST, ON_SOUL_BLAST, ON_COUNTER_CHARGE, ON_DISCARD, ON_SENT_TO_HAND, ON_SENT_TO_DECK, ON_SENT_TO_RIDE_DECK, ON_BIND, ON_MAIN_PHASE_END, ON_BATTLE_PHASE_START, ON_ATTACK, ON_BOOST, ON_STAND, ON_GUARD, ON_INTERCEPT, ON_DAMAGE_CHECK, ON_DRIVE_CHECK, ON_CHECK, BATTLE_PHASE_END, ON_END_PHASE_START, ON_END_PHASE_END, ON_TURN_END
    - Si plusieurs effets s'activent en même temps on les mets en file et on les activant 1 par 1, si l'effet ne contient pas la notion mandatory on peut choisir de l'activé ou pas, on dois vidé la file avant de continuer

### notions
- il existe des mots clé supplémentaire :
    - 1/Turn : l'effet ne peut être activé qu'une fois par tour pour cette carte
    - Divine skill : le joueur ne peut activé qu'un seul divine skill par duel
    - Regalis Piece : le joueur ne peut activé qu'un seul regalis piece par duel
    - Ace unit : le joueur ne peut avoir qu'une seul Ace unit dans le deck
    - Counter Blast : le joueur doit retourné un nombre de dommage face visible face caché
    - Soul Blast : le joueur doit envoyé un nombre de carte de la soul en drop
    - Energie Blast : le joueur doit consommé un nombre d'energie
    - Counter Charge : le joueur retourne un nombre de dommage face caché face visible
    - Soul Charge : le joueur place un nombre de carte du dessus de son deck dans la soul une a une après les avoir révélé ( on révèle => on place => etc )
    - Energie Charge : le joueur gagne un nombre d'energie
    - Generation Break : Le joueur peut activé l'effet que si il a un nombre de carte face up dans sa g zone + vanguard confondu

# Déroulement
## 1 - début de partie
- On mélange les deck
- les deux le grade 0 du ride deck en Vanguard face caché
- les deux joueur piochent 5 carte, 1 seul fois il peuvent placé les cartes de leur choix sous le deck et en repiocher le même nombre ( puis on mélange )

## 2 - Tour 1
### Stand phase
### Draw phase
- Le joueur pioche
### Ride phase
- Le joueur peut Ride
### Main Phase
- Le joueur peu call
### Battle phase
- Pas d'attaque pour le premier joueur au tour 1
### End phase

## 3 - Tour 2+

### Stand phase
- On redresse les unité engagé
### Draw phase
- Le joueur pioche
### Ride phase
- Le joueur peut Ride
### Main Phase
- Le joueur peu call et move
### Battle phase
- Le joueur peut attaquer
### End phase
