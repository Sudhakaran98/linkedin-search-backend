module.exports = (sequelize, DataTypes) => {
  return sequelize.define("Patent", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    profile_id: DataTypes.BIGINT,
    title: DataTypes.TEXT,
    description: DataTypes.TEXT,
    patent_url: DataTypes.TEXT,
    patent_number: DataTypes.TEXT,
    status: DataTypes.TEXT,
    date: DataTypes.TEXT,
    date_year: DataTypes.INTEGER,
    date_month: DataTypes.INTEGER,
    order_in_profile: DataTypes.INTEGER,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE
  }, {
    tableName: "profile_patents",
    schema: "linkedin",
    timestamps: true
  });
};