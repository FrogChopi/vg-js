import fs from 'fs';
import path from 'path';
import * as readline from 'node:readline/promises';
import Party from './core/Party.js';
import Card from './core/Card.js';
import { getPossibleActions } from './core/ActionManager.js';
import { applyAction, applyCloseStep } from './core/ActionApplier.js';
import { effects as effectLibrary } from './core/EffectLibrary.js';
import { evaluateCondition } from './core/ConditionEvaluator.js';
import cloneDeep from './core/cloneDeep.js';

/**
 * Helper to get user choice with AI evaluation.
 */
async function getPlayerChoice(party, rl, actions, actionFormatter) {
    console.log('\n--- Choose an action ---');

    // Display actions
    actions.forEach((action, index) => {
        console.log(`Option ${index}: ${actionFormatter(action, index)}`);
    });

    const answer = await rl.question(`\nPlayer ${party.currentPlayerIndex + 1}, choose your action: `);
    const choice = parseInt(answer, 10);

    if (choice >= 0 && choice < actions.length) {
        return choice;
    }
    return -1; // Invalid choice
}
/**
 * Helper function to parse strings like "Power 10000" or "Shield 5000".
 * @param {string | null | undefined} valueString - The string to parse.
 * @returns {number | null}
 */
function parseValue(valueString) {
    if (!valueString) return null;
    const match = valueString.match(/-?\d+/);
    return match ? parseInt(match[0], 10) : null;
}

/**
 * Parses a deck file in markdown format and returns the ride and main decks.
 * It uses a card database to enrich the card objects with full details.
 * @param {string} deckContent - The content of the deck file.
 * @param {object[]} cardDatabase - The array of card objects from the JSON database.
 * @returns {{rideDeck: Card[], mainDeck: Card[]}}
 */
function parseDeck(deckContent, cardDatabase) {
    const rideDeck = [];
    const mainDeck = [];
    const dbMap = new Map(cardDatabase.map(c => [c.card_number_full, c]));

    let currentDeck = null;

    const lines = deckContent.split(/\r?\n/);

    for (const line of lines) {
        if (line.startsWith('# Ride')) {
            currentDeck = rideDeck;
            continue;
        } else if (line.startsWith('# Main')) {
            currentDeck = mainDeck;
            continue;
        }

        if (currentDeck && line.trim() !== '') {
            const parts = line.split('\t').map(p => p.trim());
            if (parts.length >= 3) {
                const quantity = parseInt(parts[0].replace('x', ''), 10);
                const name = parts[1];
                const cardId = parts[parts.length - 1];

                const cardData = dbMap.get(cardId);
                if (!cardData) {
                    console.warn(`Card with ID ${cardId} not found in database. Creating a basic card.`);
                }

                let drive = 1;
                if (cardData?.skill) {
                    if (cardData.skill.includes('Twin Drive')) {
                        drive = 2;
                    } else if (cardData.skill.includes('Triple Drive')) {
                        drive = 3;
                    }
                    // Add more for Quadra, Quinta if needed
                }

                for (let i = 0; i < quantity; i++) {
                    const fullCardData = cardData ? {
                        uniqueId: `${cardId}-${i}-${Math.random()}`, // Unique ID for this specific instance
                        id: cardId,
                        name: cardData.name_face,
                        grade: parseValue(cardData.grade),
                        power: parseValue(cardData.power),
                        critical: parseValue(cardData.critical) ?? 1,
                        shield: parseValue(cardData.shield) ?? 0,
                        skills: cardData.skill ? cardData.skill.split(', ').filter(s => s !== '-') : [],
                        effects: cardData.effect ? [cardData.effect] : [], // Storing raw effect string for now
                        effectsData: { implemented_effects: cardData.implemented_effects ?? [] },
                        trigger: cardData.gift?.split(' ')[0] ?? null, // e.g., "Heal" from "Heal Trigger +10000"
                        nation: cardData.nation ?? null,
                        race: cardData.race ?? null,
                    } : { name, id: cardId };

                    // Cards with type 'Crest' are not units and should not be in decks.
                    if (cardData?.type === 'Crest') {
                        if (currentDeck === rideDeck) rideDeck.push(new Card(fullCardData, 0));
                        continue; // Do not add Crests to main deck or process them further as units
                    }

                    currentDeck.push(new Card(fullCardData, drive));
                }
            }
        }
    }

    // Sort the ride deck by grade, ascending, to ensure G0 is first.
    rideDeck.sort((a, b) => (a.grade ?? 99) - (b.grade ?? 99));

    return { rideDeck, mainDeck };
}

/**
 * Handles the mulligan phase for a given player.
 * @param {Party} currentPartyState - The current state of the game.
 * @param {readline.Interface} rl - The readline interface for user input.
 * @returns {Promise<Party>} The new game state after the mulligan.
 */
async function handleMulliganPhase(currentPartyState, rl) {
    const playerIndex = currentPartyState.currentPlayerIndex;
    console.log(`\n==== TURN ${currentPartyState.turn} - PLAYER ${playerIndex + 1} - MULLIGAN PHASE ====`);
    currentPartyState.printState(playerIndex);

    const mulliganActions = getPossibleActions(currentPartyState);
    const playerHand = currentPartyState.players[playerIndex].hand;

    const choice = await getPlayerChoice(currentPartyState, rl, mulliganActions, (action, index) => {
        const cardsToRedrawNames = action.cardIndicesToRedraw.map(i => playerHand[i]?.name || 'Unknown Card');
        return `Redraw [${cardsToRedrawNames.join(', ') || 'None'}]`;
    });

    const chosenAction = mulliganActions[choice];
    console.log(`Player ${playerIndex + 1} chose to mulligan ${chosenAction.cardIndicesToRedraw.length} card(s).`);
    
    const newParty = await applyAction(currentPartyState, chosenAction, rl);

    return newParty;
}

/**
 * Handles the Stand Phase for the current player (automatic).
 * @param {Party} currentPartyState - The current state of the game.
 * @returns {Party} The new game state.
 */
function handleStandPhase(currentPartyState) {
    const playerIndex = currentPartyState.currentPlayerIndex;
    console.log(`\n==== TURN ${currentPartyState.turn} - PLAYER ${playerIndex + 1} - STAND PHASE ====`);
    
    const activePlayer = currentPartyState.players[playerIndex];
    
    // Stand all rested units
    const standUnit = (circle) => {
        if (circle.unit) {
            circle.unit.isResting = false;
        }
    };
    activePlayer.board.frontRow.forEach(standUnit);
    activePlayer.board.backRow.forEach(standUnit);
    console.log(`All units for Player ${playerIndex + 1} are standing.`);

    currentPartyState.phase = 'draw';
    return currentPartyState;
}

/**
 * Handles the Draw Phase for the current player (automatic).
 * @param {Party} currentPartyState - The current state of the game.
 * @returns {Party} The new game state.
 */
function handleDrawPhase(currentPartyState) {
    const playerIndex = currentPartyState.currentPlayerIndex;
    console.log(`\n==== TURN ${currentPartyState.turn} - PLAYER ${playerIndex + 1} - DRAW PHASE ====`);
    
    currentPartyState.draw(playerIndex, 1);
    console.log(`Player ${playerIndex + 1} draws a card.`);

    currentPartyState.phase = 'ride';
    return currentPartyState;
}

/**
 * Handles the interactive Ride Phase for the current player.
 * @param {Party} currentPartyState - The current state of the game.
 * @param {readline.Interface} rl - The readline interface for user input.
 * @returns {Promise<Party>} The new game state after the ride.
 */
async function handleRidePhase(currentPartyState, rl) {
    const playerIndex = currentPartyState.currentPlayerIndex;
    console.log(`\n==== TURN ${currentPartyState.turn} - PLAYER ${playerIndex + 1} - RIDE PHASE ====`);

    // Trigger and immediately process ON_RIDE_PHASE_START event
    let party = currentPartyState;
    party.eventQueue.push({ type: 'ON_RIDE_PHASE_START' });
    party = await applyAction(party, { type: 'PROCESS_EVENTS' }, rl); // A dummy action to trigger event processing

    party.printState(playerIndex);

    const rideActions = getPossibleActions(party);

    const choice = await getPlayerChoice(party, rl, rideActions, (action, index) => {
        if (action.type === 'RIDE') {
            if (action.source === 'rideDeck') {
                const cardToDiscard = party.players[playerIndex].hand.find(c => c.id === action.discardCardId);
                if (cardToDiscard) {
                    return `Ride ${action.cardName} from ${action.source} (discard [G${cardToDiscard.grade}] ${cardToDiscard.name})`;
                } else {
                    return `Ride ${action.cardName} from ${action.source} (ERROR: discard card not found)`;
                }
            } else {
                return `Ride ${action.cardName} from ${action.source}`;
            }
        } else if (action.type === 'PASS_RIDE_PHASE') {
            return `Pass Ride Phase`;
        }
    });

    const chosenAction = rideActions[choice];
    const newParty = await applyAction(party, chosenAction, rl);

    return newParty;
}

/**
 * Handles the interactive Main Phase for the current player.
 * This phase is a loop where the player can perform multiple actions.
 * @param {Party} currentPartyState - The current state of the game.
 * @param {readline.Interface} rl - The readline interface for user input.
 * @returns {Promise<Party>} The new game state after the main phase.
 */
async function handleMainPhase(currentPartyState, rl) {
    let party = currentPartyState;
    const playerIndex = party.currentPlayerIndex;

    while (party.phase === 'main') {
        console.log(`\n==== TURN ${party.turn} - PLAYER ${playerIndex + 1} - MAIN PHASE ====`);
        party.printState(playerIndex);

        const mainActions = getPossibleActions(party);

        const choice = await getPlayerChoice(party, rl, mainActions, (action, index) => {
            if (action.type === 'CALL') {
                return `Call ${action.cardName} to ${action.circleTag}`;
            } else if (action.type === 'MOVE') {
                return action.description;
            } else if (action.type === 'ACT') {
                return action.description;
            } else if (action.type === 'PASS_MAIN_PHASE') {
                return `End Main Phase`;
            }
        });

        const chosenAction = mainActions[choice];
        party = await applyAction(party, chosenAction, rl);
    }

    return party;
}

/**
 * Handles the interactive Guard Step for the defending player.
 * @param {Party} currentPartyState - The current state of the game.
 * @param {readline.Interface} rl - The readline interface for user input.
 * @returns {Promise<Party>} The new game state after the guard step.
 */
async function handleGuardStep(currentPartyState, rl) {
    let party = currentPartyState;
    const defendingPlayerIndex = 1 - party.currentPlayerIndex;

    while (party.phase === 'guard') {
        console.log(`\n--- GUARD STEP: Player ${defendingPlayerIndex + 1} is defending ---`);
        party.printState(defendingPlayerIndex); // Show from defender's POV

        const guardActions = getPossibleActions(party);

        const choice = await getPlayerChoice(party, rl, guardActions, (action, index) => {
            if (action.type === 'GUARD') {
                return `Guard with ${action.cardName} (Shield: ${action.shield})`;
            } else if (action.type === 'INTERCEPT') {
                return `Intercept with ${action.cardName} (Shield: ${action.shield})`;
            } else if (action.type === 'PASS_GUARD_STEP') {
                return `Finish Guarding`;
            }
        });

        const chosenAction = guardActions[choice];
        party = await applyAction(party, chosenAction, rl);

        // If the player chose to stop guarding, the phase will have changed in applyAction.
    }

    return party;
}

/**
 * Handles the interactive Battle Phase for the current player.
 * @param {Party} currentPartyState - The current state of the game.
 * @param {readline.Interface} rl - The readline interface for user input.
 * @returns {Promise<Party>} The new game state after the battle phase.
 */
async function handleBattlePhase(currentPartyState, rl) {
    let party = currentPartyState;
    const playerIndex = party.currentPlayerIndex;

    while (party.phase === 'battle') {
        console.log(`\n==== TURN ${party.turn} - PLAYER ${playerIndex + 1} - BATTLE PHASE ====`);
        party.printState(playerIndex);

        const battleActions = getPossibleActions(party);

        const choice = await getPlayerChoice(party, rl, battleActions, (action, index) => {
            if (action.type === 'ATTACK') {
                const boostText = action.boost ? ' (with Boost)' : '';
                return `Attack with ${action.attacker.name} targeting ${action.target.name}${boostText}`;
            } else if (action.type === 'PASS_BATTLE_PHASE') {
                return `End Battle Phase`;
            }
        });

        const chosenAction = battleActions[choice];

        // For now, attack resolution is simple. Guarding and checks will be added later.
        party = await applyAction(party, chosenAction, rl);

        if (chosenAction.type === 'ATTACK') {
            console.log(`Attack resolution: ${chosenAction.attacker.name} attacks ${chosenAction.target.name}.`);
            // More detailed resolution will be inside applyAction later.
        }
    }
    return party;
}

async function handleEffectResolutionPhase(currentPartyState, rl) {
    console.log(`\n--- EFFECT RESOLUTION ---`);
    const effectActions = getPossibleActions(currentPartyState);
    const choice = await getPlayerChoice(currentPartyState, rl, effectActions, (action, index) => {
        return action.description;
    });
    const chosenAction = effectActions[choice];
    return await applyAction(currentPartyState, chosenAction, rl);
}

/**
 * Handles the End Phase for the current player (automatic).
 * @param {Party} currentPartyState - The current state of the game.
 * @returns {Party} The new game state.
 */
function handleEndPhase(currentPartyState) {
    const playerIndex = currentPartyState.currentPlayerIndex;
    console.log(`\n==== TURN ${currentPartyState.turn} - PLAYER ${playerIndex + 1} - END PHASE ====`);
    
    // Reset all "until end of turn" effects for BOTH players.
    currentPartyState.players.forEach((player, index) => {
        const allPlayerUnits = [...player.board.frontRow, ...player.board.backRow].filter(c => c.unit);
        allPlayerUnits.forEach(c => {
            if (c.unit.bonusPower > 0 || c.unit.bonusCritical > 0) {
                console.log(`> Resetting bonuses for Player ${index + 1}'s ${c.unit.name}.`);
                c.unit.bonusPower = 0;
                c.unit.bonusCritical = 0;
            }
        });
    });

    // At the end of the turn, cards in the current player's hand are no longer considered public knowledge
    // from events like drive checks during their turn.
    currentPartyState.players[playerIndex].hand.forEach(card => {
        card.isPublic = false;
    });

    console.log(`Player ${playerIndex + 1} ends their turn.`);

    currentPartyState.nextTurn();
    currentPartyState.switchPlayer();
    currentPartyState.phase = 'stand';
    
    return currentPartyState;
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Usage: node src/index.js <path/to/deck1.md> <path/to/deck2.md> [some_string]');
        process.exit(1);
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    try {
        const [deck1Path, deck2Path] = args;

        const deck1Content = fs.readFileSync(deck1Path, 'utf-8');
        const deck2Content = fs.readFileSync(deck2Path, 'utf-8');
        const cardDatabase = JSON.parse(fs.readFileSync('vg_deck_cards.json', 'utf-8'));

        const deck1 = parseDeck(deck1Content, cardDatabase);
        const deck2 = parseDeck(deck2Content, cardDatabase);

        let party = new Party(deck1, deck2);
        party.startGame();

        // Player 1 Mulligan
        if (party.phase === 'mulligan') {
            party = await handleMulliganPhase(party, rl);
        }

        // Player 2 Mulligan
        if (party.phase === 'mulligan') {
            party = await handleMulliganPhase(party, rl);
        }

        console.log('\n--- Mulligan Phase Complete ---');

        // --- Main Game Loop ---
        while (!party.isGameOver()) {
            const playerIndex = party.currentPlayerIndex;
            console.log(`\n\n<<<<<<<<<< TURN ${party.turn} - PLAYER ${playerIndex + 1} >>>>>>>>>>`);

            // Loop through the phases of a turn until the turn ends.
            // This structure allows effects to skip phases by changing `party.phase`.
            let turnOver = false;
            while (!turnOver) {
                switch (party.phase) {
                    case 'stand':
                        party = handleStandPhase(party);
                        break;
                    case 'draw':
                        party = handleDrawPhase(party);
                        break;
                    case 'ride':
                        party = await handleRidePhase(party, rl);
                        break;
                    case 'main':
                        party = await handleMainPhase(party, rl);
                        break;
                    case 'battle':
                        if (party.turn === 1) {
                            console.log('\n--- Battle Phase is skipped on Turn 1 ---');
                            party.phase = 'end';
                        } else {
                            party = await handleBattlePhase(party, rl);
                        }
                        break;
                    case 'guard':
                        party = await handleGuardStep(party, rl);
                        break;
                    case 'effect_resolution':
                        party = await handleEffectResolutionPhase(party, rl);
                        break;
                    case 'drive_check': {
                        const { attackerCircle } = party.currentBattle;
                        if (attackerCircle.name === 'V') {
                            const driveAmount = attackerCircle.unit.drive;
                            await party.driveCheck(driveAmount, rl);
                        }
                        party.phase = 'close_step'; // Move to the final step
                        break;
                    }
                    case 'close_step':
                        // This is a new phase to resolve the attack after all checks
                        party = await applyCloseStep(party, rl);
                        // applyCloseStep will set the phase to 'battle' or 'end'
                        break;
                    case 'end':
                        party = handleEndPhase(party);
                        turnOver = true; // The turn is now over, exit the inner while loop.
                        break;
                    default:
                        console.error(`Unknown game phase: ${party.phase}`);
                        turnOver = true; // Exit to prevent infinite loop
                        break;
                }
            }
        }

        console.log('\n--- GAME OVER ---');
    } catch (error) {
        console.error('Error loading decks:', error.message);
        process.exit(1);
    } finally {
        rl.close();
    }
}

main();