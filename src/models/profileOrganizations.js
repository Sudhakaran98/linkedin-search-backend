module.exports = (sequelize, DataTypes) => {
  return sequelize.define("Organization", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    profile_id: DataTypes.BIGINT,
    organization_name: DataTypes.TEXT,
    position: DataTypes.TEXT,
    description: DataTypes.TEXT,
    date_from: DataTypes.TEXT,
    date_from_year: DataTypes.INTEGER,
    date_from_month: DataTypes.INTEGER,
    date_to: DataTypes.TEXT,
    date_to_year: DataTypes.INTEGER,
    date_to_month: DataTypes.INTEGER,
    order_in_profile: DataTypes.INTEGER,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE,
  }, {
    tableName: "profile_organizations",
    schema: "linkedin",
    timestamps: true
  });
};