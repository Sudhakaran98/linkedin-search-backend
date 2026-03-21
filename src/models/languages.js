module.exports = (sequelize, DataTypes) => {
  const Language = sequelize.define(
    "Language",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      language_name: {
        type: DataTypes.STRING,
        unique: true,
        allowNull: false,
      },
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE
    },
    {
      tableName: "languages",
      schema: "linkedin",
      timestamps: true,
    }
  );

  return Language;
};