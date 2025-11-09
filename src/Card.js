export default class Card {
    constructor({
        id,
        name,
        grade,
        power,
        critical = 1,
        shield = 0,
        skills = [], // e.g., ['Boost', 'Intercept']
        effects = [], // e.g., [{type: 'AUTO', event: 'ON_CALL', cost: '...', effect: '...'}]
        trigger = null, // e.g., 'Heal', 'Critical'
        nation,
        clan,
        race
    } = {}, drive = 1) {
        this.id = id; // Unique ID for each card instance
        this.name = name;
        this.grade = grade;
        this.power = power;
        this.critical = critical;
        this.shield = shield;
        this.skills = skills;
        this.effects = effects;
        this.trigger = trigger;
        this.nation = nation;
        this.clan = clan;
        this.race = race;

        this.drive = power === null ? 0 : drive; // Non-units have 0 drive
        this.isResting = false;
        this.bonusPower = 0;
        this.bonusCritical = 0;
    }
}
