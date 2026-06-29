using ApiCore.Data;
using ApiCore.Models;
using Microsoft.EntityFrameworkCore;

namespace ApiCore.Services;

public class ReportsService
{
    private readonly AppDbContext _context;

    public ReportsService(AppDbContext context)
    {
        _context = context;
    }

    public async Task<List<AnalysisReportDto>> GetHistoryAsync(Guid userId, bool includeArchived, bool onlyArchived)
    {
        var query = _context.AnalysisReports
            .Where(r => r.UserId == userId);

        if (onlyArchived)
        {
            query = query.Where(r => r.IsArchived);
        }
        else if (!includeArchived)
        {
            query = query.Where(r => !r.IsArchived);
        }

        var reports = await query
            .OrderByDescending(r => r.CreatedAt)
            .ToListAsync();

        var listDto = new List<AnalysisReportDto>();
        foreach (var report in reports)
        {
            CourseBatchAnalysisResult? result = null;
            if (!string.IsNullOrEmpty(report.ResultJson))
            {
                result = System.Text.Json.JsonSerializer.Deserialize<CourseBatchAnalysisResult>(
                    report.ResultJson, 
                    new System.Text.Json.JsonSerializerOptions { PropertyNameCaseInsensitive = true }
                );
            }

            listDto.Add(new AnalysisReportDto
            {
                Id = report.Id,
                CourseName = report.CourseName,
                CreatedAt = report.CreatedAt,
                Status = report.Status,
                Result = result,
                Error = report.Error,
                IsArchived = report.IsArchived
            });
        }

        return listDto;
    }

    public async Task<bool> RenameReportAsync(string taskId, Guid userId, string newName)
    {
        var report = await _context.AnalysisReports.FirstOrDefaultAsync(r => r.Id == taskId && r.UserId == userId);
        if (report == null) return false;

        report.CourseName = newName.Trim();
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<bool> ArchiveReportAsync(string taskId, Guid userId)
    {
        var report = await _context.AnalysisReports.FirstOrDefaultAsync(r => r.Id == taskId && r.UserId == userId);
        if (report == null) return false;

        report.IsArchived = true;
        await _context.SaveChangesAsync();
        return true;
    }

    public async Task<bool> UnarchiveReportAsync(string taskId, Guid userId)
    {
        var report = await _context.AnalysisReports.FirstOrDefaultAsync(r => r.Id == taskId && r.UserId == userId);
        if (report == null) return false;

        report.IsArchived = false;
        await _context.SaveChangesAsync();
        return true;
    }
}
