module.exports = (sequelize, DataTypes) => {
    const Award = sequelize.define("Award", {
        id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
        profile_id: DataTypes.BIGINT,
        award_title: DataTypes.TEXT,
        issuer: DataTypes.TEXT,
        description: DataTypes.TEXT,
        award_date: DataTypes.TEXT,
        date_year: DataTypes.TEXT,
        date_month: DataTypes.TEXT,
        order_in_profile: DataTypes.INTEGER,
        created_at: DataTypes.DATE,
        updated_at: DataTypes.DATE,
    }, {
        tableName: "profile_awards",
        schema: "linkedin",
        timestamps: true
    });

    return Award;
};