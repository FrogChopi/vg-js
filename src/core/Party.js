
import { getPossibleActions } from '../ActionManager.js';
import { applyAction } from '../ActionApplier.js';
import Board from './core/Board.js';

/**
 * Manages the game flow, turns, and history between two players.
 */
class Party {
  constructor(deck1, deck2) {
    this.players = [
      this._createPlayerState(deck1),
      this._createPlayerState(deck2)
    ];
    this.turn = 0;
    this.currentPlayerIndex = 0; // 0 for player 1, 1 for player 2
    this.phase = 'setup'; // e.g., setup, mulligan, stand, draw, ride, main, battle, end
    this.currentBattle = null; // To store info about the current battle
    this.eventQueue = []; // To process game events and trigger effects
    this.history = []; // To store actions taken
  }

  _createPlayerState(deckData) {
    const rideDeckCopy = [...deckData.rideDeck];
    const startingVanguard = rideDeckCopy.shift(); // Remove the G0 from the ride deck

    return {
      deck: deckData.mainDeck,
      rideDeck: rideDeckCopy, // This is now the ride deck without the G0
      board: new Board(startingVanguard),
      hand: [],
      dropZone: [],
      damageZone: [],
      soul: [],
      gZone: [],
      bindZone: [],
      guardianZone: [],
      triggerZone: [],
      crestZone: [],
      orderZone: [],
      energy: 0,
      maxEnergy: 3,
      continuousEffects: [],
      usedTurnlyEffects: [],
    };
  }

  /** Shuffles the deck of the specified player. */
  shuffleDeck(playerIndex) {
    const player = this.players[playerIndex];
    // Fisher-Yates shuffle algorithm
    for (let i = player.deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [player.deck[i], player.deck[j]] = [player.deck[j], player.deck[i]];
    }
  }

  /** Draws cards for the specified player. */
  draw(playerIndex, count = 1) {
    const player = this.players[playerIndex];
    const drawnCards = [];
    for (let i = 0; i < count; i++) {
        if (player.deck.length > 0) {
            const card = player.deck.pop();
            player.hand.push(card);
            drawnCards.push(card);
        } else {
            console.warn(`Player ${playerIndex + 1} tried to draw but their deck is empty.`);
        }
    }
    return drawnCards;
  }

  /**
   * Performs a damage check for the specified player.
   * @param {number} playerIndex - The index of the player taking damage.
   * @param {number} amount - The amount of damage to take.
   */
  async damageCheck(playerIndex, amount = 1, rl) {
    const player = this.players[playerIndex];
    const opponent = this.players[1 - playerIndex];
    console.log(`> Player ${playerIndex + 1} performs ${amount} damage check(s).`);

    for (let i = 0; i < amount; i++) {
      if (player.deck.length > 0) {
        const checkedCard = player.deck.pop();
        console.log(`>> Damage Check ${i + 1}: [G${checkedCard.grade}] ${checkedCard.name}`);
        
        if (checkedCard.trigger) {
          console.log(`>>> ${checkedCard.trigger} Trigger Activated!`);
          await this.applyTriggerEffect(checkedCard.trigger, playerIndex, rl);
        }

        player.damageZone.push(checkedCard);
      }
    }
  }

  /**
   * Helper function to apply trigger effects.
   * @param {string} triggerType - The type of trigger ('Critical', 'Draw', 'Front', 'Heal').
   * @param {number} playerIndex - The index of the player whose trigger activated.
   * @param {readline.Interface} rl - The readline interface for user input.
   */
  async applyTriggerEffect(triggerType, playerIndex, rl) {
    const player = this.players[playerIndex];
    const opponent = this.players[1 - playerIndex];
    const boardUnits = [...player.board.frontRow, ...player.board.backRow].filter(c => c.unit).map(c => c.unit);

    if (triggerType === 'Front') {
      console.log('>>> All front row units get +10000 Power!');
      player.board.frontRow.forEach(c => {
        if (c.unit) c.unit.bonusPower += 10000;
      });
      return; // Front trigger does not give a choice.
    }

    // For Critical, Draw, and Heal, the player chooses a unit to get +10000 Power.
    console.log('>>> Choose a unit to get +10000 Power:');
    boardUnits.forEach((unit, i) => console.log(`  ${i}: [G${unit.grade}] ${unit.name} (on ${unit.circleName})`));
    const powerChoiceAnswer = await rl.question('Enter number for power boost: ');
    const powerChoiceIndex = parseInt(powerChoiceAnswer, 10);
    if (boardUnits[powerChoiceIndex]) {
      boardUnits[powerChoiceIndex].bonusPower += 10000;
      console.log(`>>> ${boardUnits[powerChoiceIndex].name} gets +10000 Power!`);
    }

    switch (triggerType) {
      case 'Critical': {
        console.log('>>> Choose a unit to get +1 Critical:');
        boardUnits.forEach((unit, i) => console.log(`  ${i}: [G${unit.grade}] ${unit.name} (on ${unit.circleName})`));
        const critChoiceAnswer = await rl.question('Enter number for critical boost: ');
        const critChoiceIndex = parseInt(critChoiceAnswer, 10);
        if (boardUnits[critChoiceIndex]) {
          boardUnits[critChoiceIndex].bonusCritical += 1;
          console.log(`>>> ${boardUnits[critChoiceIndex].name} gets +1 Critical!`);
        }
        break;
      }
      case 'Draw':
        console.log('>>> You draw a card.');
        this.draw(playerIndex, 1);
        break;
      case 'Heal':
        if (player.damageZone.length >= opponent.damageZone.length && player.damageZone.length > 0) {
          console.log('>>> You may heal 1 damage.');
          // For simplicity, we'll auto-heal the last damage taken. A real implementation would offer a choice.
          const healedCard = player.damageZone.pop();
          player.dropZone.push(healedCard);
          console.log(`>>> Healed 1 damage. [G${healedCard.grade}] ${healedCard.name} moved to drop zone.`);
        } else {
          console.log('>>> Heal condition not met (your damage must be >= opponent\'s damage).');
        }
        break;
    }
  }

  /**
   * Performs a drive check for the current player.
   * @param {number} amount - The number of drive checks to perform.
   */
  async driveCheck(amount = 1, rl) {
    const playerIndex = this.currentPlayerIndex;
    const player = this.players[playerIndex];
    console.log(`> Player ${playerIndex + 1} performs ${amount} drive check(s).`);

    for (let i = 0; i < amount; i++) {
      if (player.deck.length > 0) {
        const checkedCard = player.deck.pop();
        console.log(`>> Drive Check ${i + 1}: [G${checkedCard.grade}] ${checkedCard.name}`);
        
        if (checkedCard.trigger) {
          console.log(`>>> ${checkedCard.trigger} Trigger Activated!`);
          await this.applyTriggerEffect(checkedCard.trigger, playerIndex, rl);
        }

        player.hand.push(checkedCard);
        console.log(`>> Card added to hand.`);
      }
    }
  }

  startGame() {
    console.log("\n--- Starting Game ---");
    this.turn = 1;
    this.currentPlayerIndex = 0;
    this.phase = 'mulligan';

    this.shuffleDeck(0);
    this.shuffleDeck(1);
    this.draw(0, 5);
    this.draw(1, 5);
  }

  /**
   * Prints the entire game state to the console from a specific player's point of view.
   * @param {number} povPlayerIndex - The index of the player from whose perspective to print (0 or 1).
   */
  printState(povPlayerIndex = 0) {
    const p1Index = povPlayerIndex;
    const p2Index = 1 - povPlayerIndex;

    const player1 = this.players[p1Index];
    const player2 = this.players[p2Index];

    const separator = '-'.repeat(70);

    // --- Player 2 (Opponent) Info ---
    const p2Crests = player2.crestZone.length > 0 ? `, crests: [${player2.crestZone.map(c => c.name).join(', ')}]` : '';
    const p2Energy = `, energy: ${player2.energy}`;
    const p2Hand = `hand: [${player2.hand.map(() => '<hidden>').join(', ')}]`;
    const p2Info = `Player ${p2Index + 1} : ${p2Hand}, drop: ${player2.dropZone.length}, soul: ${player2.soul.length}, deck: ${player2.deck.length}, ride: ${player2.rideDeck.length}, damage: ${player2.damageZone.length}${p2Crests}${p2Energy}`;
    console.log(separator);
    console.log(p2Info);
    console.log(separator);

    // --- Player 2 (Opponent) Board ---
    player2.board.print(false); // `sens = false` for opponent's view (top)

    console.log(separator);

    // --- Player 1 (Current Player) Board ---
    player1.board.print(true); // `sens = true` for current player's view (bottom)

    // --- Player 1 (Current Player) Info ---
    const p1Crests = player1.crestZone.length > 0 ? `, crests: [${player1.crestZone.map(c => c.name).join(', ')}]` : '';
    const p1Energy = `, energy: ${player1.energy}`;
    const p1Hand = `hand: [${player1.hand.map(c => `[G${c.grade}] ${c.name}`).join(', ')}]`;
    const p1Info = `Player ${p1Index + 1} : ${p1Hand}, drop: ${player1.dropZone.length}, soul: ${player1.soul.length}, deck: ${player1.deck.length}, ride: ${player1.rideDeck.length}, damage: ${player1.damageZone.length}${p1Crests}${p1Energy}`;
    console.log(separator);
    console.log(p1Info);
    console.log(separator);
  }

  runTurn() {
    // Turn logic will be implemented here
  }

  nextTurn() {
    this.turn++;
    // Reset once-per-turn effects for both players at the start of a new turn cycle (Player 1's turn)
    if (this.currentPlayerIndex === 1) {
        this.players.forEach(p => p.usedTurnlyEffects = []);
    }
  }

  switchPlayer() {
    this.currentPlayerIndex = 1 - this.currentPlayerIndex;
  }

  isGameOver() {
    // Game over conditions: a player has 6 or more damage, or decks out.
    // Or a turn limit for the simulation.
    return this.turn > 6 || this.players.some(p => p.damageZone.length >= 6);
  }
}

export default Party;
