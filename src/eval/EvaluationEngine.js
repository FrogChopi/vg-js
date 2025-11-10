import Node from './Node.js';
import { getPossibleActions } from '../core/ActionManager.js';
import { applyAction } from '../core/ActionApplier.js';
import cloneDeep from '../core/cloneDeep.js';

/**
 * Implements a Monte Carlo Tree Search (MCTS) engine to evaluate game choices.
 */
export default class EvaluationEngine {
    /**
     * @param {Party} initialState - The initial state of the game to start the search from.
     * @param {object} options - Configuration for the engine.
     */
    constructor(initialState, options = {}) {
        this.root = new Node(cloneDeep(initialState));
        this.timeLimit = options.timeLimit || 10000; // 10 seconds
        this.explorationConstant = options.explorationConstant || 1.41; // C value for UCT
    }

    /**
     * Starts the search and returns the best evaluated actions.
     * @param {object[]} actions - The list of possible actions from the current state.
     * @returns {Promise<object[]>} A list of evaluated actions, sorted by score.
     */
    async search(actions) {
        const startTime = Date.now();
        let iterations = 0;

        while (Date.now() - startTime < this.timeLimit && iterations < 2000) {
            // Create a determinized state for this single iteration
            const determinizedState = this._determinize(this.root.state);

            // 1. Selection
            let node = this._select(this.root, determinizedState);

            // 2. Expansion
            if (!node.isTerminal) {
                await this._expand(node, determinizedState, actions);
                if (node.children.length > 0) {
                    node = node.children[Math.floor(Math.random() * node.children.length)];
                }
            }

            // 3. Simulation (Rollout)
            const result = await this._simulate(node.state);

            // 4. Backpropagation
            this._backpropagate(node, result);
            iterations++;
        }

        console.log(`> MCTS completed ${iterations} iterations.`);

        // The best action is the one with the most visits.
        this.root.children.sort((a, b) => b.visits - a.visits);
        return this.root.children.map(node => {
            const scoreData = node.visits > 0 ? node.scoreData : { gradeScore: 0, damageScore: 0 };
            const avgGradeScore = scoreData.gradeScore / node.visits;
            const avgDamageScore = scoreData.damageScore / node.visits;
            const finalScore = (avgGradeScore * 0.4) + (avgDamageScore * 0.6);

            return { action: node.action, score: finalScore || 0, depth: node.visits, gradeScore: avgGradeScore || 0, damageScore: avgDamageScore || 0 };
        });
    }

    /**
     * Selection phase: Traverse the tree using UCT to find the best node to expand.
     */
    _select(node, determinizedState) {
        while (!node.isTerminal) {
            if (!node.isFullyExpanded(determinizedState)) {
                return node;
            }

            if (node.children.length === 0) {
                // If a node is fully expanded but has no children, it's a terminal leaf.
                return node;
            }

            const parentNode = node;
            node = parentNode.children.reduce((best, child) => {
                const uct = (child.wins / child.visits) + this.explorationConstant * Math.sqrt(Math.log(node.visits) / child.visits);
                return uct > best.uct ? { node: child, uct } : best;
            }, { node: null, uct: -Infinity }).node;

            if (!node) return parentNode; // Fallback: if no best child, return the parent.
        }
        return node;
    }

    /**
     * Expansion phase: Create a new child node from an unexpanded action.
     */
    async _expand(node, determinizedState, actions) {
        for (const action of actions) {
            // Check if this action has already been expanded
            if (!node.children.some(c => JSON.stringify(c.action) === JSON.stringify(action))) {
                const nextState = await applyAction(determinizedState, action, null);
                const newNode = new Node(nextState, node, action);
                node.children.push(newNode);
                return newNode; // Expand one at a time
            }
        }
    }

    /**
     * Simulation phase: From a given node, play a random game to the end and return a heuristic score.
     */
    async _simulate(state) {
      let currentState = cloneDeep(state);
      let turnCount = 0; // Safety break
      let attacksThisTurn = 0;
      let lastPlayerIndex = -1;
  
      while (!currentState.isGameOver() && turnCount < 20) { // Reduced rollout depth for speed
          const actions = getPossibleActions(currentState);
          if (actions.length === 0) break;
  
          let chosenAction;
  
          if (currentState.phase === 'guard') {
              const defendingPlayer = currentState.players[1 - currentState.currentPlayerIndex];
              const { attackerPower } = currentState.currentBattle;
              const targetPower = currentState.currentBattle.targetCircle.unit.power;
              const powerNeeded = attackerPower - targetPower;
  
              let shouldGuard = false;
              if (defendingPlayer.damageZone.length >= 5) {
                  shouldGuard = true; // Desperation: guard everything
              } else {
                  // Guard 2 out of 3 attacks
                  shouldGuard = (attacksThisTurn % 3) !== 0;
              }
  
              if (shouldGuard && powerNeeded > 0) {
                  const guardsFromHand = actions.filter(a => a.type === 'GUARD');
                  guardsFromHand.sort((a, b) => b.shield - a.shield); // Use best shield cards first
  
                  let currentShield = 0;
                  const guardsToUse = [];
                  for (const guardAction of guardsFromHand) {
                      if (currentShield < powerNeeded) {
                          guardsToUse.push(guardAction);
                          currentShield += guardAction.shield;
                      } else {
                          break;
                      }
                  }
  
                  if (currentShield >= powerNeeded) {
                      // For simplicity, we just apply the first guard action of the chosen set.
                      // A real simulation would apply them all, but our action system is one-by-one.
                      chosenAction = guardsToUse[0];
                  }
              }
  
              if (!chosenAction) {
                  chosenAction = actions.find(a => a.type === 'PASS_GUARD_STEP');
              }
  
          } else {
              chosenAction = actions[Math.floor(Math.random() * actions.length)];
          }
  
          if (currentState.currentPlayerIndex !== lastPlayerIndex) {
              attacksThisTurn = 0;
              lastPlayerIndex = currentState.currentPlayerIndex;
          }
          if (chosenAction.type === 'ATTACK') {
              attacksThisTurn++;
          }
  
          currentState = await applyAction(currentState, chosenAction, null);
          turnCount++;
      }
  
      // Heuristic evaluation at the end of the rollout
      const aiPlayerIndex = state.currentPlayerIndex;
      const opponentPlayerIndex = 1 - state.currentPlayerIndex;
  
      const aiPlayer = currentState.players[aiPlayerIndex];
      const opponentPlayer = currentState.players[opponentPlayerIndex];
  
      const vanguardGrade = aiPlayer.board.getCircle('V').unit?.grade ?? 0;
      const opponentDamage = opponentPlayer.damageZone.length;
  
      // Normalize scores
      const gradeScore = Math.min(vanguardGrade / 4, 1.0); // Max grade around 4
      const damageScore = Math.min(opponentDamage / 6, 1.0); // Max damage is 6
  
      return { gradeScore, damageScore };
    }

    /**
     * Backpropagation phase: Update wins and visits from the result of the simulation.
     */
    _backpropagate(node, result) {
        let parent = node.parent;
        let current = node;

        while (current !== null) {
            current.visits++;
            // Accumulate raw scores. We will average them at the end.
            // No inversion needed as scores are absolute (grade, opponent damage).
            current.scoreData.gradeScore += result.gradeScore;
            current.scoreData.damageScore += result.damageScore;

            parent = parent.parent;
            current = parent;
        }
    }

    /**
     * Advances the root of the tree to one of its children.
     * @param {object} action - The action chosen by the user.
     */
    advance(action) {
        const nextNode = this.root.children.find(child => JSON.stringify(child.action) === JSON.stringify(action));
        if (nextNode) {
            this.root = nextNode;
            this.root.parent = null; // The new root has no parent
            console.log('> AI tree advanced.');
        } else {
            console.warn('> AI could not find matching action to advance tree. Tree will be rebuilt on next turn.');
            this.root = null; // Invalidate the tree
        }
    }

    /**
     * Creates a single, random, but plausible complete state from a state with hidden information.
     * @param {Party} state The original game state.
     * @returns {Party} A determinized state.
     */
    _determinize(state) {
        const detState = cloneDeep(state);
        const aiPlayerIndex = detState.currentPlayerIndex;
        const opponentIndex = 1 - state.currentPlayerIndex;

        // 2. Determinize opponent's hand and deck based on statistical constraints
        const opponent = detState.players[opponentIndex];
        const opponentHandSize = opponent.hand.filter(c => !c.isPublic).length;
        const publicOpponentCardsInHand = opponent.hand.filter(c => c.isPublic);

        // Pool of all unknown cards for the opponent
        const unknownPool = [
            ...opponent.deck,
            ...opponent.hand.filter(c => !c.isPublic)
        ];

        // --- Constraint-based dealing ---
        // Count known cards of specific types for the opponent
        const knownZones = [
            ...publicOpponentCardsInHand,
            ...opponent.board.frontRow.map(c => c.unit),
            ...opponent.board.backRow.map(c => c.unit),
            ...opponent.dropZone,
            ...opponent.damageZone,
            ...opponent.soul,
        ].filter(Boolean);

        const knownTriggers = knownZones.filter(c => c.trigger).length;
        const knownHeals = knownZones.filter(c => c.trigger === 'Heal').length;
        const knownSentinels = knownZones.filter(c => c.skills.includes('Sentinel')).length;

        // Calculate how many of each must be in the unknown pool
        const requiredTriggers = Math.max(0, 16 - knownTriggers);
        const requiredHeals = Math.max(0, 4 - knownHeals);
        const requiredSentinels = Math.max(0, 4 - knownSentinels);

        // Separate the pool into categories
        const poolHeals = unknownPool.filter(c => c.trigger === 'Heal');
        const poolOtherTriggers = unknownPool.filter(c => c.trigger && c.trigger !== 'Heal');
        const poolSentinels = unknownPool.filter(c => c.skills.includes('Sentinel') && !c.trigger); // Sentinels can be triggers
        const poolNormals = unknownPool.filter(c => !c.trigger && !c.skills.includes('Sentinel'));

        // Function to shuffle an array
        const shuffle = (arr) => arr.sort(() => Math.random() - 0.5);

        // Build the new determinized hand and deck
        const newOpponentHand = [...publicOpponentCardsInHand];
        let newOpponentDeck = [];

        // Take required cards and shuffle the rest back into a general pool
        const finalPool = [];
        const requiredHealCards = shuffle(poolHeals).splice(0, requiredHeals);
        const requiredOtherTriggerCards = shuffle(poolOtherTriggers).splice(0, requiredTriggers - requiredHeals);
        const requiredSentinelCards = shuffle(poolSentinels).splice(0, requiredSentinels);

        finalPool.push(
            ...poolHeals, ...poolOtherTriggers, ...poolSentinels, ...poolNormals,
            ...requiredHealCards, ...requiredOtherTriggerCards, ...requiredSentinelCards
        );
        shuffle(finalPool);

        // Deal the new hand
        while (newOpponentHand.length < opponent.hand.length && finalPool.length > 0) {
            newOpponentHand.push(finalPool.pop());
        }

        // The rest is the new deck
        newOpponentDeck = finalPool;

        opponent.hand = newOpponentHand;
        opponent.deck = newOpponentDeck;

        return detState;
    }
}