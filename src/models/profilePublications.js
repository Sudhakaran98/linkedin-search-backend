module.exports = (sequelize, DataTypes) => {
  const Publication = sequelize.define("Publication", {
    id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
    profile_id: DataTypes.BIGINT,
    title: DataTypes.TEXT,
    description: DataTypes.TEXT,
    publication_url: DataTypes.TEXT,
    publication_names: DataTypes.ARRAY(DataTypes.TEXT),
    date: DataTypes.TEXT,
    date_year: DataTypes.INTEGER,
    date_month: DataTypes.INTEGER,
    order_in_profile: DataTypes.INTEGER,
    created_at: DataTypes.DATE,
    updated_at: DataTypes.DATE
  }, {
    tableName: "profile_publications",
    schema: "linkedin",
    timestamps: true
  });

  return Publication;
};