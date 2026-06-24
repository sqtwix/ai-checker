using ApiCore.Models;
using Microsoft.EntityFrameworkCore;

namespace ApiCore.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    // Таблица пользователей
    public DbSet<User> Users => Set<User>();

    /// <summary>
    /// Конфигурация схемы базы данных при помощи Fluent API
    /// </summary>
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        // Настраиваем правила для сущности User в PostgreSQL
        modelBuilder.Entity<User>(entity =>
        {
            // Делаем колонку username уникальной на уровне СУБД
            entity.HasIndex(u => u.Username)
                .IsUnique()
                .HasDatabaseName("ix_users_username");

            // Делаем колонку email уникальной на уровне СУБД
            entity.HasIndex(u => u.Email)
                .IsUnique()
                .HasDatabaseName("ix_users_email");
        });
    }
}