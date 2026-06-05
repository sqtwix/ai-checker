using Microsoft.AspNetCore.Mvc;

namespace ApiCore.Controllers;

public class FileController : Controller
{
    public IActionResult Index()
    {
            return View();
    }
}

