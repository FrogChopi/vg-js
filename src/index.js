import fs from 'fs';
import path from 'path';
import * as readline from 'node:readline/promises';
import Party from './core/Party.js';
import Card from './core/Card.js';
import { getPossibleActions } from './core/ActionManager.js';
import { applyAction, applyCloseStep } from './core/ActionApplier.js';
import { effects as effectLibrary } from './core/EffectLibrary.js';
import { evaluateCondition } from './core/ConditionEvaluator.js';

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
 * Processes the event queue in the game state, triggering card effects.
 * @param {Party} currentPartyState - The current state of the game.
 * @returns {Promise<Party>} The new game state after all effects are resolved.
 */
async function processEventQueue(currentPartyState, rl) {
    let party = currentPartyState;

    while (party.eventQueue.length > 0) {
        const event = party.eventQueue.shift(); // Get the first event
        console.log(`> Processing event: ${event.type}`);

        const pendingEffects = [];
        const eventTriggerName = event.type.toLowerCase(); // e.g., 'on_ride'

        // --- 1. Collect all triggered effects for this event ---
        // This is the "Observer" part. It scans all relevant zones for cards
        // that might react to the current event.
        const player = party.players[party.currentPlayerIndex];
        const opponent = party.players[1 - party.currentPlayerIndex];

        const allCardsInPlay = [
            ...player.board.frontRow.map(c => ({ card: c.unit, zone: 'board' })),
            ...player.board.backRow.map(c => ({ card: c.unit, zone: 'board' })),
            ...player.rideDeck.map(c => ({ card: c, zone: 'rideDeck' })),
            ...player.crestZone.map(c => ({ card: c, zone: 'crestZone' })),
            ...player.soul.map(c => ({ card: c, zone: 'soul' })),
            // Add opponent's cards if effects can trigger on opponent's turn
        ].filter(item => item.card);

        for (const { card, zone } of allCardsInPlay) {
            if (card.effectsData?.implemented_effects) {
                for (const effect of card.effectsData.implemented_effects) {
                    // Check trigger type
                    if (effect.trigger !== eventTriggerName) continue;

                    // Check zone if specified. If not, default to board/crest.
                    if (effect.zone && effect.zone !== zone) continue;

                    // Check condition
                    if (!evaluateCondition(effect.condition, party)) continue;

                    // All checks passed, add to the effect queue
                    pendingEffects.push({
                        cardName: card.name,
                        cardId: card.id,
                        effect: effect,
                        eventPayload: event
                    });
                }
            }
        }

        // --- 2. Interactively resolve collected effects ---
        while (pendingEffects.length > 0) {
            const mandatoryEffects = pendingEffects.filter(p => p.effect.mandatory);
            const optionalEffects = pendingEffects.filter(p => !p.effect.mandatory);

            let chosenEffect = null;
            let choiceIndex = -1;

            if (mandatoryEffects.length > 0) {
                console.log(`\n--- Mandatory Effects for Player ${party.currentPlayerIndex + 1} ---`);
                mandatoryEffects.forEach((pending, index) => {
                    console.log(`  ${index}: Activate effect of ${pending.cardName}`);
                });

                let choice = '0';
                if (mandatoryEffects.length > 1) {
                    const answer = await rl.question('Choose which mandatory effect to resolve first: ');
                    choice = answer;
                }
                choiceIndex = parseInt(choice, 10);
                if (!isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < mandatoryEffects.length) {
                    chosenEffect = mandatoryEffects[choiceIndex];
                }
            } else if (optionalEffects.length > 0) {
                console.log(`\n--- Optional Effects for Player ${party.currentPlayerIndex + 1} ---`);
                optionalEffects.forEach((pending, index) => {
                    console.log(`  ${index}: Activate effect of ${pending.cardName}`);
                });
                console.log(`  ${optionalEffects.length}: Do not activate an effect`);

                const answer = await rl.question('Choose an option: ');
                choiceIndex = parseInt(answer, 10);
                if (!isNaN(choiceIndex) && choiceIndex >= 0 && choiceIndex < optionalEffects.length) {
                    chosenEffect = optionalEffects[choiceIndex];
                }
            }

            if (chosenEffect) {
                // Remove the chosen effect from the main list and resolve it.
                const originalIndex = pendingEffects.findIndex(p => p.cardId === chosenEffect.cardId && p.effect.function_index === chosenEffect.effect.function_index);
                pendingEffects.splice(originalIndex, 1);
                const effectFunction = effectLibrary[chosenEffect.effect.function_index];
                await effectFunction(party, chosenEffect.eventPayload, rl);
            } else {
                // No effect chosen or no more effects to resolve.
                break;
            }
        }
    }

    return party;
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

    console.log(`\n--- Mulligan Options for Player ${playerIndex + 1} ---`);
    const mulliganActions = getPossibleActions(currentPartyState);
    const playerHand = currentPartyState.players[playerIndex].hand;

    mulliganActions.forEach((action, index) => {
        const cardsToRedrawNames = action.cardIdsToRedraw.map(id => playerHand.find(c => c.id === id)?.name || 'Unknown Card');
        console.log(`Option ${index}: Redraw [${cardsToRedrawNames.join(', ') || 'None'}]`);
    });

    let choice = -1;
    while (choice < 0 || choice >= mulliganActions.length || isNaN(choice)) {
        const answer = await rl.question(`\nPlayer ${playerIndex + 1}, choose your mulligan option (0-${mulliganActions.length - 1}): `);
        choice = parseInt(answer, 10);
        if (choice < 0 || choice >= mulliganActions.length || isNaN(choice)) {
            console.log('Invalid choice. Please enter a valid option number.');
        }
    }

    const chosenAction = mulliganActions[choice];
    console.log(`Player ${playerIndex + 1} chose to mulligan ${chosenAction.cardIdsToRedraw.length} card(s).`);
    
    let newParty = await applyAction(currentPartyState, chosenAction, rl);
    newParty = await processEventQueue(newParty, rl);

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

    // Trigger ON_RIDE_PHASE_START event
    let party = currentPartyState;
    party.eventQueue.push({ type: 'ON_RIDE_PHASE_START' });
    party = await processEventQueue(party, rl);

    party.printState(playerIndex);

    const rideActions = getPossibleActions(party);

    console.log(`\n--- Ride Options for Player ${playerIndex + 1} ---`);
    rideActions.forEach((action, index) => {
        if (action.type === 'RIDE') {
            if (action.source === 'rideDeck') {
                const cardToDiscard = party.players[playerIndex].hand.find(c => c.id === action.discardCardId);
                console.log(`Option ${index}: Ride ${action.cardId} from ${action.source} (discard [G${cardToDiscard.grade}] ${cardToDiscard.name})`);
            } else {
                console.log(`Option ${index}: Ride ${action.cardId} from ${action.source}`);
            }
        } else if (action.type === 'PASS_RIDE_PHASE') {
            console.log(`Option ${index}: Pass Ride Phase`);
        }
    });

    const answer = await rl.question(`\nPlayer ${playerIndex + 1}, choose your ride option: `);
    const choice = parseInt(answer, 10);
    // TODO: Add input validation

    const chosenAction = rideActions[choice];
    let newParty = await applyAction(party, chosenAction, rl);
    newParty = await processEventQueue(newParty, rl);

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

        console.log(`\n--- Main Phase Actions for Player ${playerIndex + 1} ---`);
        mainActions.forEach((action, index) => {
            if (action.type === 'CALL') {
                console.log(`Option ${index}: Call ${action.cardName} to ${action.circleTag}`);
            } else if (action.type === 'MOVE') {
                console.log(`Option ${index}: ${action.description}`);
            } else if (action.type === 'ACT') {
                console.log(`Option ${index}: ${action.description}`);
            } else if (action.type === 'PASS_MAIN_PHASE') {
                console.log(`Option ${index}: End Main Phase`);
            }
        });

        const answer = await rl.question(`\nPlayer ${playerIndex + 1}, choose your action: `);
        const choice = parseInt(answer, 10);
        // TODO: Add input validation

        const chosenAction = mainActions[choice];
        let newParty = await applyAction(party, chosenAction, rl);
        newParty = await processEventQueue(newParty, rl);
        party = newParty;
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

        console.log(`\n--- Guard Options for Player ${defendingPlayerIndex + 1} ---`);
        guardActions.forEach((action, index) => {
            if (action.type === 'GUARD') {
                console.log(`Option ${index}: Guard with ${action.cardName} (Shield: ${action.shield})`);
            } else if (action.type === 'INTERCEPT') {
                console.log(`Option ${index}: Intercept with ${action.cardName} (Shield: ${action.shield})`);
            } else if (action.type === 'PASS_GUARD_STEP') {
                console.log(`Option ${index}: Finish Guarding`);
            }
        });

        const answer = await rl.question(`\nPlayer ${defendingPlayerIndex + 1}, choose your guard action: `);
        const choice = parseInt(answer, 10);
        // TODO: Add input validation

        const chosenAction = guardActions[choice];
        let newParty = await applyAction(party, chosenAction, rl);
        newParty = await processEventQueue(newParty, rl);
        party = newParty;

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

        console.log(`\n--- Battle Phase Actions for Player ${playerIndex + 1} ---`);
        battleActions.forEach((action, index) => {
            if (action.type === 'ATTACK') {
                const boostText = action.boost ? ' (with Boost)' : '';
                console.log(`Option ${index}: Attack with ${action.attacker.name} targeting ${action.target.name}${boostText}`);
            } else if (action.type === 'PASS_BATTLE_PHASE') {
                console.log(`Option ${index}: End Battle Phase`);
            }
        });

        const answer = await rl.question(`\nPlayer ${playerIndex + 1}, choose your action: `);
        const choice = parseInt(answer, 10);
        // TODO: Add input validation

        const chosenAction = battleActions[choice];

        // For now, attack resolution is simple. Guarding and checks will be added later.
        let newParty = await applyAction(party, chosenAction, rl);
        newParty = await processEventQueue(newParty, rl);
        party = newParty;

        if (chosenAction.type === 'ATTACK') {
            console.log(`Attack resolution: ${chosenAction.attacker.name} attacks ${chosenAction.target.name}.`);
            // More detailed resolution will be inside applyAction later.
        }
    }
    return party;
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
                        let newParty = await applyCloseStep(party, rl);
                        newParty = await processEventQueue(newParty, rl);
                        party = newParty;
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