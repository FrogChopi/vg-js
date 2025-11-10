/**
 * @file Node.js
 * Represents a node in the game state tree for the evaluation engine.
 */
import { getPossibleActions } from '../core/ActionManager.js';

export default class Node {
    /**
     * @param {Party} state - The game state this node represents.
     * @param {Node | null} parent - The parent node.
     * @param {object | null} action - The action that led to this state.
     */
    constructor(state, parent = null, action = null) {
        this.state = state;
        this.parent = parent;
        this.action = action;
        this.children = [];
        
        // MCTS specific properties
        this.wins = 0;
        this.visits = 0;
        this.scoreData = {
            gradeScore: 0,
            damageScore: 0,
        };
    }

    get isTerminal() {
        return this.state.isGameOver();
    }

    isFullyExpanded(determinizedState) {
        return this.children.length > 0 && this.children.length === getPossibleActions(determinizedState).length;
    }
}