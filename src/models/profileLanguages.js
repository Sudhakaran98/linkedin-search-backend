module.exports = (sequelize, DataTypes) => {
  const ProfileLanguage = sequelize.define(
    "ProfileLanguage",
    {
      id: {
        type: DataTypes.BIGINT,
        primaryKey: true,
        autoIncrement: true,
      },
      profile_id: {
        type: DataTypes.BIGINT,
        allowNull: false,
      },
      language_id: {
        type: DataTypes.BIGINT,
        allowNull: true, // null until normalize.sql backfills it
      },
      // denormalized language name — stored during ingestion, normalized later
      language_name: DataTypes.TEXT,
      proficiency: DataTypes.TEXT,
      order_in_profile: DataTypes.INTEGER,
      created_at: DataTypes.DATE,
      updated_at: DataTypes.DATE,
    },
    {
      tableName: "profile_languages",
      schema: "linkedin",
      timestamps: true,
    }
  );

  return ProfileLanguage;
};
