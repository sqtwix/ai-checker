namespace ApiCore.Models;
/*
Класс для сервсиа валидации, который хранит ошибки 
*/


public class ValidationResult
{
    public bool IsValid => !Errors.Any();
    public List<string> Errors { get; set; } = new();

    public void AddError(string error) => Errors.Add(error);
}

